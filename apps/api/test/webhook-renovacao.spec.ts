import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Payment, Subscription } from '@sonora/db';
import { PLANS } from '@sonora/shared';
import { BillingService } from '../src/billing/billing.service';
import type { WebhookEvent } from '../src/billing/payment.provider';

/**
 * A renovação mensal de uma assinatura.
 *
 * Só a primeira cobrança é gravada, no checkout. No mês seguinte o Asaas gera
 * outra e avisa PAYMENT_CONFIRMED com um id novo. A versão anterior de
 * `findPayment` respondia com a última cobrança da assinatura — a do mês
 * anterior, já com `creditsGranted` — e quem pagou o segundo mês ficava sem
 * crédito. Sem erro e sem log: só o silêncio de 0 créditos numa conta paga.
 */

type Linha = Record<string, unknown> & { id: string; createdAt: Date };

/** Um banco em memória com o pedaço do TypeORM que o webhook usa. */
function bancoFalso(semente: { subscriptions: object[]; payments: object[] }) {
  let sequencia = 0;
  const materializar = (dados: object): Linha => {
    sequencia += 1;
    return {
      id: `id_${sequencia}`,
      createdAt: new Date(sequencia * 1000),
      creditsGranted: false,
      ...dados,
    } as Linha;
  };

  const tabelas = new Map<unknown, Linha[]>([
    [Subscription, semente.subscriptions.map(materializar)],
    [Payment, semente.payments.map(materializar)],
  ]);

  const casa = (where: Record<string, unknown>) => (linha: Linha) =>
    Object.entries(where).every(([campo, valor]) => linha[campo] === valor);

  const repositorio = (entidade: unknown) => {
    const linhas = tabelas.get(entidade);
    if (!linhas) throw new Error('entidade fora do banco falso');
    return {
      findOneBy: async (where: Record<string, unknown>) => linhas.find(casa(where)) ?? null,
      findOne: async ({ where }: { where: Record<string, unknown> }) =>
        linhas
          .filter(casa(where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      create: (dados: object) => ({ ...dados }),
      save: async (dados: object) => {
        // O índice único de providerRef, que decide a corrida entre entregas.
        const ref = (dados as { providerRef?: string }).providerRef;
        if (ref && linhas.some((l) => l.providerRef === ref)) {
          throw new Error('duplicate key value violates unique constraint');
        }
        const linha = materializar(dados);
        linhas.push(linha);
        return linha;
      },
      update: async (where: Record<string, unknown>, mudanca: object) => {
        linhas.filter(casa(where)).forEach((l) => Object.assign(l, mudanca));
      },
    };
  };

  return {
    dataSource: {
      getRepository: repositorio,
      transaction: async (fn: (em: { getRepository: typeof repositorio }) => Promise<unknown>) =>
        fn({ getRepository: repositorio }),
    },
    linhas: (entidade: unknown) => tabelas.get(entidade) ?? [],
  };
}

const ASSINATURA = {
  id: 'sub_local',
  userId: 'u1',
  planCode: 'pro',
  status: 'active',
  providerId: 'asaas',
  providerRef: 'sub_1',
};

/** A cobrança do primeiro mês, já creditada no checkout. */
const PRIMEIRO_MES = {
  id: 'pay_local_1',
  userId: 'u1',
  subscriptionId: 'sub_local',
  packCode: null,
  amountBrl: '39',
  method: 'boleto',
  status: 'confirmed',
  providerId: 'asaas',
  providerRef: 'pay_1',
  creditsGranted: true,
};

function montar(
  semente: { subscriptions: object[]; payments: object[] } = {
    subscriptions: [ASSINATURA],
    payments: [PRIMEIRO_MES],
  },
) {
  const banco = bancoFalso(semente);
  const grant = vi.fn().mockResolvedValue(undefined);
  const servico = new BillingService(
    banco.dataSource as never,
    { id: 'asaas' } as never,
    { grant } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (servico as unknown as { logger: object }).logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { servico, grant, banco };
}

const SEGUNDO_MES: WebhookEvent = {
  kind: 'payment_confirmed',
  paymentRef: 'pay_2',
  subscriptionRef: 'sub_1',
  amountBrl: 39,
  method: 'pix',
  raw: {},
};

describe('BillingService.handleWebhook numa renovação', () => {
  it('credita o segundo mês, cuja cobrança ainda não existe na tabela', async () => {
    const { servico, grant, banco } = montar();

    const r = await servico.handleWebhook(SEGUNDO_MES);

    expect(r).toEqual({ handled: true, creditsGranted: PLANS.pro.monthlyCredits });
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledWith('u1', PLANS.pro.monthlyCredits, 'plan', 'plan_renewal', 'Plano Pro');

    const cobrancas = banco.linhas(Payment);
    expect(cobrancas).toHaveLength(2);
    expect(cobrancas[1]).toMatchObject({
      subscriptionId: 'sub_local',
      providerRef: 'pay_2',
      method: 'pix',
      amountBrl: '39',
      status: 'confirmed',
      creditsGranted: true,
    });
  });

  it('a segunda entrega do mesmo evento não credita de novo', async () => {
    const { servico, grant, banco } = montar();

    await servico.handleWebhook(SEGUNDO_MES);
    const repetido = await servico.handleWebhook(SEGUNDO_MES);

    expect(repetido).toEqual({ handled: true, creditsGranted: 0 });
    expect(grant).toHaveBeenCalledTimes(1);
    expect(banco.linhas(Payment)).toHaveLength(2);
  });

  it('a cobrança do primeiro mês continua sendo achada pelo id dela', async () => {
    const { servico, grant, banco } = montar({
      subscriptions: [ASSINATURA],
      payments: [{ ...PRIMEIRO_MES, status: 'pending', creditsGranted: false }],
    });

    const r = await servico.handleWebhook({ ...SEGUNDO_MES, paymentRef: 'pay_1' });

    expect(r.creditsGranted).toBe(PLANS.pro.monthlyCredits);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(banco.linhas(Payment)).toHaveLength(1);
  });

  it('herda o método da cobrança anterior quando o evento não traz um', async () => {
    const { servico, banco } = montar();

    await servico.handleWebhook({ ...SEGUNDO_MES, method: undefined });

    expect(banco.linhas(Payment)[1]).toMatchObject({ providerRef: 'pay_2', method: 'boleto' });
  });

  it('renovação vencida registra a cobrança como falha e a assinatura como atrasada', async () => {
    const { servico, grant, banco } = montar();

    const r = await servico.handleWebhook({
      kind: 'payment_failed',
      paymentRef: 'pay_3',
      subscriptionRef: 'sub_1',
      amountBrl: 39,
      raw: {},
    });

    expect(r).toEqual({ handled: true });
    expect(grant).not.toHaveBeenCalled();
    expect(banco.linhas(Payment)[1]).toMatchObject({ providerRef: 'pay_3', status: 'failed' });
    expect(banco.linhas(Subscription)[0]).toMatchObject({ status: 'past_due' });
  });

  it('ignora cobrança de assinatura que não é nossa', async () => {
    const { servico, grant, banco } = montar();

    const r = await servico.handleWebhook({ ...SEGUNDO_MES, subscriptionRef: 'sub_de_outro_sistema' });

    expect(r).toEqual({ handled: false });
    expect(grant).not.toHaveBeenCalled();
    expect(banco.linhas(Payment)).toHaveLength(1);
  });
});

describe('BillingService.handleWebhook num cancelamento vindo do gateway', () => {
  const REMOVIDA: WebhookEvent = { kind: 'subscription_canceled', subscriptionRef: 'sub_1', raw: {} };

  it('cancela a assinatura mesmo sem cobrança no evento', async () => {
    const { servico, banco } = montar();

    const r = await servico.handleWebhook(REMOVIDA);

    expect(r).toEqual({ handled: true });
    expect(banco.linhas(Subscription)[0]).toMatchObject({ status: 'canceled' });
    expect(banco.linhas(Subscription)[0].canceledAt).toBeInstanceOf(Date);
  });

  it('não reescreve a data de uma assinatura que nós mesmos já cancelamos', async () => {
    const antes = new Date('2026-09-01T12:00:00Z');
    const { servico, banco } = montar({
      subscriptions: [{ ...ASSINATURA, status: 'canceled', canceledAt: antes }],
      payments: [PRIMEIRO_MES],
    });

    await servico.handleWebhook(REMOVIDA);

    expect(banco.linhas(Subscription)[0].canceledAt).toBe(antes);
  });

  it('não trata assinatura desconhecida', async () => {
    const { servico } = montar();

    const r = await servico.handleWebhook({ ...REMOVIDA, subscriptionRef: 'sub_de_outro_sistema' });

    expect(r).toEqual({ handled: false });
  });
});
