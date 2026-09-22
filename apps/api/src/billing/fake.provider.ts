import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ChargeInput,
  CustomerInput,
  PaymentProvider,
  PaymentResult,
  SubscriptionInput,
  WebhookEvent,
} from './payment.provider';

/**
 * Gateway de mentira, para desenvolvimento e teste.
 *
 * Confirma tudo na hora. Existe para o fluxo de assinatura e de pacote poder
 * ser exercitado inteiro sem credencial de gateway e sem cobrar ninguém — e
 * para os testes não dependerem de um serviço externo no ar.
 *
 * A configuração recusa `PAYMENT_PROVIDER=fake` em produção, para isto aqui
 * nunca virar a forma de ganhar crédito de graça.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly id = 'fake';
  readonly requiresTaxId = false;
  private readonly logger = new Logger(FakePaymentProvider.name);

  async ensureCustomer(input: CustomerInput): Promise<string> {
    return `fake_cus_${input.userId}`;
  }

  async createSubscription(input: SubscriptionInput): Promise<PaymentResult> {
    this.logger.warn(
      `Assinatura FALSA de ${input.planCode} por R$ ${input.priceBrl} — nenhum valor foi cobrado.`,
    );
    return { ref: `fake_sub_${randomUUID()}`, status: 'confirmed' };
  }

  async cancelSubscription(subscriptionRef: string): Promise<void> {
    this.logger.warn(`Assinatura FALSA ${subscriptionRef} cancelada.`);
  }

  async createCharge(input: ChargeInput): Promise<PaymentResult> {
    this.logger.warn(
      `Cobrança FALSA de R$ ${input.priceBrl} (${input.description}) — nada foi cobrado.`,
    );
    return { ref: `fake_pay_${randomUUID()}`, status: 'confirmed' };
  }

  parseWebhook(body: unknown): WebhookEvent {
    const evento = body as { event?: string; payment?: { id?: string; externalReference?: string } };
    return {
      kind: evento.event === 'PAYMENT_CONFIRMED' ? 'payment_confirmed' : 'ignored',
      paymentRef: evento.payment?.id,
      externalReference: evento.payment?.externalReference,
      raw: body,
    };
  }
}
