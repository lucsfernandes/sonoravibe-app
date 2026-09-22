import type { PlanCode } from '@sonora/shared';

/**
 * Contrato do gateway de pagamento.
 *
 * O Asaas fica atrás desta interface porque gateway se troca: mudança de
 * condição comercial, entrada em outro país, ou simplesmente uma taxa melhor.
 * Com a interface, trocar é escrever uma classe nova; sem ela, seria caçar
 * chamadas de API espalhadas por todo o código de cobrança.
 */

export type PaymentMethod = 'pix' | 'credit_card' | 'boleto';

export interface CustomerInput {
  userId: string;
  name: string;
  email: string;
  /** CPF/CNPJ. O Asaas exige para cobrança no Brasil. */
  taxId?: string;
}

export interface SubscriptionInput {
  customerRef: string;
  planCode: PlanCode;
  priceBrl: number;
  method: PaymentMethod;
  description: string;
}

export interface ChargeInput {
  customerRef: string;
  priceBrl: number;
  method: PaymentMethod;
  description: string;
  /** Nosso id, devolvido pelo gateway no webhook, para casar o pagamento. */
  externalReference: string;
}

export interface PaymentResult {
  /** Id no gateway: da assinatura, numa assinatura; da cobrança, num pacote. */
  ref: string;
  /**
   * Id da cobrança quando `ref` é de uma assinatura. É por ele que o webhook
   * reencontra o pagamento; a assinatura em si nunca aparece num evento de
   * pagamento.
   */
  paymentRef?: string;
  status: 'pending' | 'confirmed' | 'failed';
  /** Página segura do gateway (cartão, boleto e também o Pix). */
  paymentUrl?: string;
  /** Pix copia-e-cola. */
  pixQrCode?: string;
  /** QR do Pix em PNG base64, sem o prefixo data:. */
  pixImage?: string;
  dueDate?: string;
}

/** O que sobra de um evento de webhook depois de traduzido do formato do gateway. */
export interface WebhookEvent {
  kind: 'payment_confirmed' | 'payment_failed' | 'subscription_canceled' | 'ignored';
  paymentRef?: string;
  subscriptionRef?: string;
  externalReference?: string;
  amountBrl?: number;
  /** Como a cobrança foi paga. Numa renovação é a única fonte: a linha ainda não existe. */
  method?: PaymentMethod;
  raw: unknown;
}

export interface PaymentProvider {
  readonly id: string;
  /** O gateway recusa cobrança sem CPF/CNPJ do cliente. */
  readonly requiresTaxId: boolean;

  /** Cria (ou reaproveita) o cliente no gateway, atualizando o documento. */
  ensureCustomer(input: CustomerInput): Promise<string>;

  createSubscription(input: SubscriptionInput): Promise<PaymentResult>;
  cancelSubscription(subscriptionRef: string): Promise<void>;

  /** Cobrança avulsa — pacotes de crédito. */
  createCharge(input: ChargeInput): Promise<PaymentResult>;

  /**
   * Traduz o corpo do webhook. Recebe os headers junto porque a autenticidade
   * do evento é verificada aqui dentro: cada gateway assina de um jeito.
   */
  parseWebhook(body: unknown, headers: Record<string, string | string[] | undefined>): WebhookEvent;
}

export const PAYMENT_PROVIDER = Symbol('sonora.paymentProvider');

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
