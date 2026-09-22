import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsaasProvider } from '../src/billing/asaas.provider';

/**
 * Dois erros que só apareceram com o gateway de verdade:
 *
 *  - Um cliente que já existia no Asaas sem CPF nunca recebia o CPF: o
 *    provider devolvia o id e ignorava o documento. Toda cobrança dele falhava
 *    com "preencha o CPF", por mais que a pessoa informasse.
 *  - `POST /subscriptions` devolve a assinatura (status ACTIVE), não uma
 *    cobrança. Lida como cobrança, virava `failed` e sem link para pagar. O
 *    link está na primeira cobrança, que precisa ser buscada.
 */

function provider() {
  return new AsaasProvider({
    ASAAS_API_KEY: 'chave-de-teste',
    ASAAS_BASE_URL: 'https://asaas.test/v3',
    ASAAS_WEBHOOK_TOKEN: 'token',
  } as never);
}

/** Um `fetch` que responde por rota e registra o que recebeu. */
function fetchFalso(rotas: Record<string, unknown>) {
  const chamadas: { url: string; method: string; body?: unknown }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const caminho = url.replace('https://asaas.test/v3', '');
    const chave = `${init.method} ${caminho}`;
    chamadas.push({ url: caminho, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (!(chave in rotas)) return new Response('{"errors":[{"description":"rota nao prevista"}]}', { status: 404 });
    return new Response(JSON.stringify(rotas[chave]), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());

describe('AsaasProvider.ensureCustomer', () => {
  it('atualiza o CPF de um cliente que já existia sem documento', async () => {
    const chamadas = fetchFalso({
      'GET /customers?email=ana%40exemplo.com': { data: [{ id: 'cus_1', cpfCnpj: null }] },
      'PUT /customers/cus_1': { id: 'cus_1' },
    });

    const id = await provider().ensureCustomer({
      userId: 'u1',
      name: 'Ana',
      email: 'ana@exemplo.com',
      taxId: '12345678909',
    });

    expect(id).toBe('cus_1');
    expect(chamadas.find((c) => c.method === 'PUT')?.body).toEqual({
      name: 'Ana',
      cpfCnpj: '12345678909',
    });
  });

  it('não mexe no cliente quando o CPF já é o mesmo', async () => {
    const chamadas = fetchFalso({
      'GET /customers?email=ana%40exemplo.com': { data: [{ id: 'cus_1', cpfCnpj: '12345678909' }] },
    });

    await provider().ensureCustomer({
      userId: 'u1',
      name: 'Ana',
      email: 'ana@exemplo.com',
      taxId: '12345678909',
    });

    expect(chamadas.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('AsaasProvider.createSubscription', () => {
  it('devolve a primeira cobrança como pendente, com o link de pagamento', async () => {
    fetchFalso({
      'POST /subscriptions': { id: 'sub_1', status: 'ACTIVE' },
      'GET /subscriptions/sub_1/payments?limit=1': {
        data: [{ id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://asaas.test/i/pay_1' }],
      },
    });

    const r = await provider().createSubscription({
      customerRef: 'cus_1',
      planCode: 'pro',
      priceBrl: 39,
      method: 'boleto',
      description: 'Sonora Pro',
    });

    expect(r).toMatchObject({
      ref: 'sub_1',
      paymentRef: 'pay_1',
      status: 'pending',
      paymentUrl: 'https://asaas.test/i/pay_1',
    });
  });

  it('traz o QR do Pix quando o método é pix', async () => {
    fetchFalso({
      'POST /subscriptions': { id: 'sub_1', status: 'ACTIVE' },
      'GET /subscriptions/sub_1/payments?limit=1': {
        data: [{ id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://asaas.test/i/pay_1' }],
      },
      'GET /payments/pay_1/pixQrCode': { encodedImage: 'iVBORw0', payload: '00020126...' },
    });

    const r = await provider().createSubscription({
      customerRef: 'cus_1',
      planCode: 'pro',
      priceBrl: 39,
      method: 'pix',
      description: 'Sonora Pro',
    });

    expect(r.pixQrCode).toBe('00020126...');
    expect(r.pixImage).toBe('iVBORw0');
  });
});

describe('AsaasProvider.parseWebhook', () => {
  it('traduz o billingType da cobrança para o nosso método', () => {
    const evento = provider().parseWebhook(
      {
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_2', status: 'CONFIRMED', billingType: 'BOLETO', subscription: 'sub_1', value: 39 },
      },
      { 'asaas-access-token': 'token' },
    );

    expect(evento).toMatchObject({
      kind: 'payment_confirmed',
      paymentRef: 'pay_2',
      subscriptionRef: 'sub_1',
      amountBrl: 39,
      method: 'boleto',
    });
  });

  it('acha a assinatura num evento SUBSCRIPTION_DELETED, que não tem cobrança', () => {
    const evento = provider().parseWebhook(
      { event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1', status: 'INACTIVE', deleted: true } },
      { 'asaas-access-token': 'token' },
    );

    expect(evento).toMatchObject({ kind: 'subscription_canceled', subscriptionRef: 'sub_1' });
    expect(evento.paymentRef).toBeUndefined();
  });

  it('deixa o método vazio quando o cliente ainda vai escolher na fatura', () => {
    const evento = provider().parseWebhook(
      { event: 'PAYMENT_CREATED', payment: { id: 'pay_3', status: 'PENDING', billingType: 'UNDEFINED' } },
      { 'asaas-access-token': 'token' },
    );

    expect(evento.method).toBeUndefined();
  });
});
