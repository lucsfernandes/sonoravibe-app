import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PLAN_CODES } from '@sonora/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, type SessionUser } from '../auth/session.guard';
import { parseOrThrow } from '../common/parse';
import { BillingService, type CheckoutView, type CreditsView } from './billing.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment.provider';
import { Inject } from '@nestjs/common';

const checkoutSchema = z.object({
  method: z.enum(['pix', 'credit_card', 'boleto']).default('pix'),
  /** Nome para a fatura, quando diferente do nome da conta. */
  name: z.string().trim().min(2).max(120).optional(),
  /** CPF/CNPJ — o Asaas exige para cobrança no Brasil. Aceita com ou sem pontuação. */
  taxId: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length === 11 || v.length === 14, 'CPF tem 11 dígitos e CNPJ tem 14.')
    .optional(),
});

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
  ) {}

  @Get('credits')
  credits(@CurrentUser() user: SessionUser): Promise<CreditsView> {
    return this.billing.creditsOf(user.id);
  }

  /** Catálogo público: a página de vendas precisa dele sem login. */
  @Public()
  @Get('plans')
  plans(@CurrentUser() user: SessionUser | undefined) {
    // O catálogo é público (a página de vendas precisa dele sem login), mas o
    // diagnóstico de onde os planos vieram só vai para quem tem sessão.
    //
    // `source: 'codigo'` significa "a tabela `plans` sumiu ou o Postgres não
    // responde". É sinal de problema interno, e numa rota sem autenticação
    // vira reconhecimento de graça para quem estiver sondando. Os preços são
    // públicos; o estado da nossa infraestrutura, não.
    return this.billing.catalogue({ comDiagnostico: Boolean(user) });
  }

  @Post('billing/subscribe')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  subscribe(@CurrentUser() user: SessionUser, @Body() body: unknown): Promise<CheckoutView> {
    const data = parseOrThrow(
      checkoutSchema.extend({ planCode: z.enum(PLAN_CODES) }),
      body,
      'assinatura',
    );
    return this.billing.subscribe(user.id, data.planCode, data.method, data.taxId, data.name);
  }

  @Post('billing/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: SessionUser) {
    return this.billing.cancelSubscription(user.id);
  }

  @Post('billing/packs/:code/purchase')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  buyPack(
    @CurrentUser() user: SessionUser,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<CheckoutView> {
    const data = parseOrThrow(checkoutSchema, body, 'compra de pacote');
    return this.billing.buyPack(user.id, code, data.method, data.taxId, data.name);
  }

  /**
   * Webhook do gateway.
   *
   * Público por necessidade — quem chama é o Asaas, sem sessão. A autenticidade
   * é verificada pelo provider (token no header), e responder 200 mesmo para
   * evento não tratado evita que o gateway reenvie para sempre algo que nunca
   * vamos processar.
   */
  @Public()
  @Post('webhooks/asaas')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body() body: unknown, @Req() req: Request) {
    const event = this.gateway.parseWebhook(body, req.headers);
    const result = await this.billing.handleWebhook(event);
    return { received: true, ...result };
  }
}
