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
  /** CPF/CNPJ — o Asaas exige para cobrança no Brasil. */
  taxId: z.string().trim().min(11).max(18).optional(),
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
  plans() {
    return this.billing.catalogue();
  }

  @Post('billing/subscribe')
  subscribe(@CurrentUser() user: SessionUser, @Body() body: unknown): Promise<CheckoutView> {
    const data = parseOrThrow(
      checkoutSchema.extend({ planCode: z.enum(PLAN_CODES) }),
      body,
      'assinatura',
    );
    return this.billing.subscribe(user.id, data.planCode, data.method, data.taxId);
  }

  @Post('billing/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: SessionUser) {
    return this.billing.cancelSubscription(user.id);
  }

  @Post('billing/packs/:code/purchase')
  buyPack(
    @CurrentUser() user: SessionUser,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<CheckoutView> {
    const data = parseOrThrow(checkoutSchema, body, 'compra de pacote');
    return this.billing.buyPack(user.id, code, data.method, data.taxId);
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
