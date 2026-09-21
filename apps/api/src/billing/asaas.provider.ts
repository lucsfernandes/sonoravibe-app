import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config/env';
import {
  PaymentProviderError,
  type ChargeInput,
  type CustomerInput,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentResult,
  type SubscriptionInput,
  type WebhookEvent,
} from './payment.provider';

/**
 * Asaas — gateway brasileiro com Pix, boleto e cartão.
 *
 * Duas coisas moldam o código abaixo:
 *
 *  - O webhook é autenticado por um token fixo no header `asaas-access-token`,
 *    e não por assinatura HMAC do corpo. Comparamos em tempo constante para não
 *    vazar o token por diferença de tempo de resposta.
 *  - O Asaas reenvia o evento enquanto não receber 200. Toda concessão de
 *    crédito derivada daqui precisa ser idempotente pelo id do pagamento.
 */

const BILLING_TYPE: Record<PaymentMethod, string> = {
  pix: 'PIX',
  credit_card: 'CREDIT_CARD',
  boleto: 'BOLETO',
};

interface AsaasCustomer {
  id: string;
}
interface AsaasPayment {
  id: string;
  status: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  dueDate?: string;
  value?: number;
  externalReference?: string;
  subscription?: string;
}

export class AsaasProvider implements PaymentProvider {
  readonly id = 'asaas';
  private readonly logger = new Logger(AsaasProvider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookToken?: string;

  constructor(config: AppConfig) {
    if (!config.ASAAS_API_KEY) throw new Error('AsaasProvider exige ASAAS_API_KEY.');
    this.apiKey = config.ASAAS_API_KEY;
    this.baseUrl = config.ASAAS_BASE_URL.replace(/\/+$/, '');
    this.webhookToken = config.ASAAS_WEBHOOK_TOKEN;
  }

  async ensureCustomer(input: CustomerInput): Promise<string> {
    // O Asaas casa por e-mail; reaproveitar evita cliente duplicado a cada
    // assinatura do mesmo usuário.
    const existing = await this.request<{ data: AsaasCustomer[] }>(
      `/customers?email=${encodeURIComponent(input.email)}`,
      { method: 'GET' },
    );
    if (existing.data?.[0]) return existing.data[0].id;

    const created = await this.request<AsaasCustomer>('/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        cpfCnpj: input.taxId,
        externalReference: input.userId,
      }),
    });
    return created.id;
  }

  async createSubscription(input: SubscriptionInput): Promise<PaymentResult> {
    const payment = await this.request<AsaasPayment>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: input.customerRef,
        billingType: BILLING_TYPE[input.method],
        value: input.priceBrl,
        cycle: 'MONTHLY',
        description: input.description,
        nextDueDate: hoje(),
      }),
    });
    return this.toResult(payment);
  }

  async cancelSubscription(subscriptionRef: string): Promise<void> {
    await this.request(`/subscriptions/${subscriptionRef}`, { method: 'DELETE' });
  }

  async createCharge(input: ChargeInput): Promise<PaymentResult> {
    const payment = await this.request<AsaasPayment>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: input.customerRef,
        billingType: BILLING_TYPE[input.method],
        value: input.priceBrl,
        description: input.description,
        externalReference: input.externalReference,
        dueDate: hoje(),
      }),
    });
    return this.toResult(payment);
  }

  parseWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookEvent {
    if (this.webhookToken) {
      const recebido = String(headers['asaas-access-token'] ?? '');
      if (!seguraIgual(recebido, this.webhookToken)) {
        throw new PaymentProviderError('Token de webhook inválido.', this.id, 401);
      }
    } else {
      // Sem token configurado qualquer um pode chamar o webhook e conceder
      // crédito a si mesmo. Recusar é mais seguro do que confiar.
      throw new PaymentProviderError(
        'ASAAS_WEBHOOK_TOKEN não configurado: webhook recusado.',
        this.id,
        401,
      );
    }

    const evento = body as { event?: string; payment?: AsaasPayment };
    const payment = evento.payment;

    const kind = ((): WebhookEvent['kind'] => {
      switch (evento.event) {
        case 'PAYMENT_CONFIRMED':
        case 'PAYMENT_RECEIVED':
          return 'payment_confirmed';
        case 'PAYMENT_OVERDUE':
        case 'PAYMENT_REFUNDED':
        case 'PAYMENT_DELETED':
          return 'payment_failed';
        case 'SUBSCRIPTION_DELETED':
          return 'subscription_canceled';
        default:
          return 'ignored';
      }
    })();

    if (kind === 'ignored') {
      this.logger.debug(`Evento ignorado do Asaas: ${evento.event}`);
    }

    return {
      kind,
      paymentRef: payment?.id,
      subscriptionRef: payment?.subscription,
      externalReference: payment?.externalReference,
      amountBrl: payment?.value,
      raw: body,
    };
  }

  private toResult(payment: AsaasPayment): PaymentResult {
    return {
      ref: payment.id,
      status:
        payment.status === 'CONFIRMED' || payment.status === 'RECEIVED'
          ? 'confirmed'
          : payment.status === 'PENDING' || payment.status === 'AWAITING_RISK_ANALYSIS'
            ? 'pending'
            : 'failed',
      paymentUrl: payment.invoiceUrl ?? payment.bankSlipUrl,
      dueDate: payment.dueDate,
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });

    const texto = await response.text();
    if (!response.ok) {
      // A mensagem do Asaas vem em errors[0].description e é bem específica
      // ("CPF inválido", "valor abaixo do mínimo"). Vale repassar.
      let detalhe = texto.slice(0, 300);
      try {
        const json = JSON.parse(texto) as { errors?: { description?: string }[] };
        detalhe = json.errors?.[0]?.description ?? detalhe;
      } catch {
        // corpo não-JSON: fica o texto cru mesmo
      }
      throw new PaymentProviderError(
        `Asaas respondeu ${response.status}: ${detalhe}`,
        this.id,
        response.status,
      );
    }

    return texto ? (JSON.parse(texto) as T) : ({} as T);
  }
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Comparação em tempo constante.
 *
 * Um `===` vaza, pelo tempo de resposta, quantos caracteres iniciais batem —
 * é o bastante para descobrir o token por tentativa e erro.
 */
function seguraIgual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
