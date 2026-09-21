import { describe, expect, it, vi } from 'vitest';
import { PlanRenewalService } from '../src/plans/plan-renewal.service';

/**
 * A renovação da cota nunca pode derrubar a leitura de saldo.
 *
 * Isto quebrou em produção. A primeira versão consultava a tabela `plans`
 * direto e o cluster sobe com `DB_SYNCHRONIZE=false`, então a tabela ainda não
 * existia. O erro subia e `GET /credits` devolvia 500 — a rota que a interface
 * chama em TODO carregamento de página. Um crédito não concedido derrubou o
 * aplicativo inteiro.
 *
 * Renovação é benefício, não requisito: falhar custa ao usuário esperar o
 * próximo ciclo. Falhar o saldo custa o produto.
 */

/** Monta o serviço com as dependências trocadas por dublês. */
function montar(opcoes: {
  planoErro?: Error;
  bancoErro?: Error;
  cycleCredits?: number | null;
  cycleDays?: number | null;
}) {
  const grant = vi.fn().mockResolvedValue(undefined);

  const planos = {
    porCodigo: opcoes.planoErro
      ? vi.fn().mockRejectedValue(opcoes.planoErro)
      : vi.fn().mockResolvedValue({
          code: 'free',
          name: 'Free',
          priceBrl: 0,
          monthlyCredits: 0,
          cycleCredits: opcoes.cycleCredits ?? 30,
          cycleDays: opcoes.cycleDays ?? 30,
          features: {},
        }),
  };

  const dataSource = {
    getRepository: () => ({
      findOne: opcoes.bancoErro
        ? vi.fn().mockRejectedValue(opcoes.bancoErro)
        : vi.fn().mockResolvedValue(null),
    }),
  };

  const servico = new PlanRenewalService(
    dataSource as never,
    { grant } as never,
    planos as never,
  );

  // O logger do Nest escreve no stderr do teste sem acrescentar nada.
  (servico as unknown as { logger: object }).logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return { servico, grant, planos };
}

describe('PlanRenewalService', () => {
  it('devolve 0 em vez de estourar quando o catálogo de planos falha', async () => {
    // O caso exato de produção: a tabela `plans` não existia.
    const { servico } = montar({ planoErro: new Error('relation "plans" does not exist') });

    await expect(servico.renovarSeVirouCiclo('user_1', 'free')).resolves.toBe(0);
  });

  it('devolve 0 em vez de estourar quando o banco cai no meio', async () => {
    const { servico } = montar({ bancoErro: new Error('connection terminated') });

    await expect(servico.renovarSeVirouCiclo('user_1', 'free')).resolves.toBe(0);
  });

  it('não renova plano pago, que recebe crédito pela cobrança', async () => {
    const { servico, grant } = montar({ cycleCredits: null, cycleDays: null });

    expect(await servico.renovarSeVirouCiclo('user_1', 'pro')).toBe(0);
    expect(grant).not.toHaveBeenCalled();
  });

  it('não concede quando a carteira ainda não existe', async () => {
    // `findOne` devolve null: conta recém-criada, antes do onboarding terminar.
    const { servico, grant } = montar({});

    expect(await servico.renovarSeVirouCiclo('user_1', 'free')).toBe(0);
    expect(grant).not.toHaveBeenCalled();
  });
});
