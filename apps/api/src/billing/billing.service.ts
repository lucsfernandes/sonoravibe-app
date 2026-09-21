import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreditTransaction, CreditWallet, Payment, Subscription, User } from '@sonora/db';
import {
  CREDIT_PACKS,
  PACK_VALIDITY_MONTHS,
  PLANS,
  maxDurationFor,
  type CreditPack,
  type PlanCode,
} from '@sonora/shared';
import { DataSource } from 'typeorm';
import { CreditsService } from '../credits/credits.service';
import { CONFIG, type AppConfig } from '../config/env';
import { DATA_SOURCE } from '../database/database.module';
import { PlanRenewalService } from '../plans/plan-renewal.service';
import { PlansRepository } from '../plans/plans.repository';
import { PlansService } from '../plans/plans.service';
import {
  PAYMENT_PROVIDER,
  type PaymentMethod,
  type PaymentProvider,
  type WebhookEvent,
} from './payment.provider';

export interface CreditsView {
  planCode: PlanCode;
  balance: { plan: number; pack: number; total: number; reserved: number };
  packValidityMonths: number;
  transactions: {
    amount: number;
    bucket: string;
    reason: string;
    description: string | null;
    balanceAfter: number;
    createdAt: Date;
  }[];
}

export interface CheckoutView {
  paymentId: string;
  status: string;
  amountBrl: number;
  paymentUrl?: string;
  pixQrCode?: string;
  /** Preenchido quando o gateway confirma na hora (Pix pago, ou o provider fake). */
  creditsGranted?: number;
}

/**
 * Assinaturas, pacotes de crédito e o webhook do gateway.
 *
 * A regra que organiza tudo aqui: **crédito só entra na carteira quando o
 * pagamento é confirmado**, e a confirmação é idempotente pela flag
 * `credits_granted` do pagamento. O Asaas reenvia o mesmo evento enquanto não
 * receber 200 — sem a flag, uma retentativa daria crédito duas vezes.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
    private readonly credits: CreditsService,
    private readonly plans: PlansService,
    private readonly planos: PlansRepository,
    private readonly renovacao: PlanRenewalService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async creditsOf(userId: string): Promise<CreditsView> {
    const planCode = await this.plans.planCodeOf(userId);

    // A cota do Free é renovada aqui, e não por CronJob, porque o gatilho certo
    // é a visita: só faz sentido creditar quem voltou. Um cron percorreria todas
    // as contas do banco a cada ciclo, inclusive as abandonadas.
    //
    // Este é o caminho que toda visita percorre: a interface lê `/credits` para
    // mostrar o saldo no menu. Roda antes do saldo ser lido, senão o usuário
    // veria o valor de ontem e só o de hoje no próximo refresh.
    await this.renovacao.renovarSeVirouCiclo(userId, planCode);

    const [balance, wallet] = await Promise.all([
      this.credits.balanceOf(userId),
      this.dataSource.getRepository(CreditWallet).findOneBy({ userId }),
    ]);

    const transactions = wallet
      ? await this.dataSource.getRepository(CreditTransaction).find({
          where: { walletId: wallet.id },
          order: { createdAt: 'DESC' },
          take: 50,
        })
      : [];

    return {
      planCode,
      balance,
      packValidityMonths: PACK_VALIDITY_MONTHS,
      transactions: transactions.map((t) => ({
        amount: t.amount,
        bucket: t.bucket,
        reason: t.reason,
        description: t.description,
        balanceAfter: t.balanceAfter,
        createdAt: t.createdAt,
      })),
    };
  }

  async catalogue({ comDiagnostico = false }: { comDiagnostico?: boolean } = {}) {
    // Os planos vêm da tabela `plans`, não da constante do código: mudar preço
    // ou texto de venda é um UPDATE, não um deploy.
    const planos = await this.planos.listar();

    return {
      // 'banco' ou 'codigo'. Sem isto não dá para saber, de fora, se um UPDATE
      // na tabela `plans` vai surtir efeito: os dois caminhos servem os mesmos
      // valores, porque um é semente do outro.
      //
      // Só para quem está logado: é estado interno, e numa resposta pública
      // avisaria a qualquer um que o banco está degradado.
      ...(comDiagnostico ? { source: await this.planos.origemAtual() } : {}),
      // A duração sai daqui já limitada ao que o motor ligado entrega. Publicar
      // o número cru do plano faria a página de preços prometer 8 min enquanto
      // a API recusa qualquer coisa acima do que o provedor aguenta.
      plans: planos.map((plan) => ({
        ...plan,
        features: {
          ...plan.features,
          maxDurationSeconds: maxDurationFor(plan.code, this.config.MUSIC_PROVIDER),
        },
      })),
      packs: CREDIT_PACKS,
      gateway: this.gateway.id,
    };
  }

  async subscribe(
    userId: string,
    planCode: PlanCode,
    method: PaymentMethod,
    taxId?: string,
  ): Promise<CheckoutView> {
    if (planCode === 'free') {
      throw new BadRequestException('O plano Free não precisa de assinatura.');
    }

    const plan = PLANS[planCode];
    const atual = await this.plans.planCodeOf(userId);
    if (atual === planCode) {
      throw new BadRequestException(`Você já está no plano ${plan.name}.`);
    }

    const user = await this.userOf(userId);
    const customerRef = await this.gateway.ensureCustomer({
      userId,
      name: user.name,
      email: user.email,
      taxId,
    });

    const result = await this.gateway.createSubscription({
      customerRef,
      planCode,
      priceBrl: plan.priceBrl,
      method,
      description: `Sonora ${plan.name} — ${plan.monthlyCredits} créditos por mês`,
    });

    const { payment, subscription } = await this.dataSource.transaction(async (em) => {
      const subscription = await em.getRepository(Subscription).save(
        em.getRepository(Subscription).create({
          userId,
          planCode,
          // Só vira 'active' quando o pagamento confirma: marcar antes daria
          // acesso pago a quem abriu o checkout e não pagou.
          status: result.status === 'confirmed' ? 'active' : 'pending',
          providerId: this.gateway.id,
          providerRef: result.ref,
          currentPeriodStart: result.status === 'confirmed' ? new Date() : null,
          currentPeriodEnd: result.status === 'confirmed' ? emUmMes() : null,
        }),
      );

      const payment = await em.getRepository(Payment).save(
        em.getRepository(Payment).create({
          userId,
          subscriptionId: subscription.id,
          amountBrl: String(plan.priceBrl),
          method,
          status: result.status === 'confirmed' ? 'confirmed' : 'pending',
          providerId: this.gateway.id,
          providerRef: result.ref,
          checkoutUrl: result.paymentUrl ?? null,
          pixPayload: result.pixQrCode ?? null,
          paidAt: result.status === 'confirmed' ? new Date() : null,
        }),
      );

      return { payment, subscription };
    });

    const granted =
      result.status === 'confirmed'
        ? await this.grantForPayment(payment.id)
        : 0;

    this.logger.log(
      `Assinatura ${subscription.id} (${planCode}) criada via ${this.gateway.id}: ${result.status}`,
    );

    return {
      paymentId: payment.id,
      status: result.status,
      amountBrl: plan.priceBrl,
      paymentUrl: result.paymentUrl,
      pixQrCode: result.pixQrCode,
      ...(granted ? { creditsGranted: granted } : {}),
    };
  }

  async cancelSubscription(userId: string): Promise<{ canceledAt: Date }> {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
    if (!subscription) throw new NotFoundException('Nenhuma assinatura ativa.');

    if (subscription.providerRef) {
      await this.gateway.cancelSubscription(subscription.providerRef);
    }

    const canceledAt = new Date();
    await this.dataSource.getRepository(Subscription).update(
      { id: subscription.id },
      // O acesso vale até o fim do período já pago: cancelar não é estornar.
      { status: 'canceled', canceledAt },
    );

    this.logger.log(`Assinatura ${subscription.id} cancelada; acesso até ${subscription.currentPeriodEnd?.toISOString() ?? 'imediato'}`);
    return { canceledAt };
  }

  async buyPack(
    userId: string,
    packCode: string,
    method: PaymentMethod,
    taxId?: string,
  ): Promise<CheckoutView> {
    const pack = CREDIT_PACKS.find((p) => p.code === packCode);
    if (!pack) throw new NotFoundException(`Pacote '${packCode}' não existe.`);

    const user = await this.userOf(userId);
    const customerRef = await this.gateway.ensureCustomer({
      userId,
      name: user.name,
      email: user.email,
      taxId,
    });

    // O id do pagamento é gerado antes da chamada ao gateway para viajar como
    // externalReference: é por ele que o webhook reencontra a cobrança, mesmo
    // que a resposta da criação se perca no caminho.
    const payment = this.dataSource.getRepository(Payment).create({
      userId,
      packCode: pack.code,
      amountBrl: String(pack.priceBrl),
      method,
      status: 'pending',
      providerId: this.gateway.id,
      providerRef: `pendente-${Date.now()}`,
    });
    await this.dataSource.getRepository(Payment).save(payment);

    const result = await this.gateway.createCharge({
      customerRef,
      priceBrl: pack.priceBrl,
      method,
      description: `Sonora — ${pack.label}`,
      externalReference: payment.id,
    });

    await this.dataSource.getRepository(Payment).update(
      { id: payment.id },
      {
        providerRef: result.ref,
        status: result.status === 'confirmed' ? 'confirmed' : 'pending',
        checkoutUrl: result.paymentUrl ?? null,
        pixPayload: result.pixQrCode ?? null,
        paidAt: result.status === 'confirmed' ? new Date() : null,
      },
    );

    const granted = result.status === 'confirmed' ? await this.grantForPayment(payment.id) : 0;

    return {
      paymentId: payment.id,
      status: result.status,
      amountBrl: pack.priceBrl,
      paymentUrl: result.paymentUrl,
      pixQrCode: result.pixQrCode,
      ...(granted ? { creditsGranted: granted } : {}),
    };
  }

  /**
   * Trata o evento do gateway.
   *
   * Responde sempre que processou, inclusive para evento desconhecido: devolver
   * erro faria o Asaas reenviar indefinidamente um evento que nunca vamos tratar.
   */
  async handleWebhook(event: WebhookEvent): Promise<{ handled: boolean; creditsGranted?: number }> {
    if (event.kind === 'ignored') return { handled: false };

    const payment = await this.findPayment(event);
    if (!payment) {
      this.logger.warn(
        `Webhook ${event.kind} sem pagamento correspondente (ref ${event.paymentRef}).`,
      );
      return { handled: false };
    }

    if (event.kind === 'payment_confirmed') {
      const creditsGranted = await this.grantForPayment(payment.id);
      return { handled: true, creditsGranted };
    }

    if (event.kind === 'payment_failed') {
      await this.dataSource.getRepository(Payment).update({ id: payment.id }, { status: 'failed' });
      if (payment.subscriptionId) {
        await this.dataSource
          .getRepository(Subscription)
          .update({ id: payment.subscriptionId }, { status: 'past_due' });
      }
      return { handled: true };
    }

    if (event.kind === 'subscription_canceled' && payment.subscriptionId) {
      await this.dataSource
        .getRepository(Subscription)
        .update({ id: payment.subscriptionId }, { status: 'canceled', canceledAt: new Date() });
      return { handled: true };
    }

    return { handled: false };
  }

  /**
   * Concede os créditos de um pagamento confirmado — uma vez só.
   *
   * A flag `creditsGranted` é lida e escrita dentro da mesma transação, com a
   * linha travada: duas entregas simultâneas do mesmo webhook não podem as duas
   * ver `false` e creditar em dobro.
   */
  private async grantForPayment(paymentId: string): Promise<number> {
    const { credits, userId, description } = await this.dataSource.transaction(async (em) => {
      const payment = await em.getRepository(Payment).findOne({
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException('Pagamento não encontrado.');
      if (payment.creditsGranted) return { credits: 0, userId: payment.userId, description: '' };

      await em.getRepository(Payment).update(
        { id: payment.id },
        { status: 'confirmed', paidAt: payment.paidAt ?? new Date(), creditsGranted: true },
      );

      if (payment.packCode) {
        const pack = CREDIT_PACKS.find((p) => p.code === payment.packCode) as CreditPack;
        return { credits: pack.credits, userId: payment.userId, description: pack.label };
      }

      if (payment.subscriptionId) {
        const subscription = await em
          .getRepository(Subscription)
          .findOneBy({ id: payment.subscriptionId });
        if (!subscription) return { credits: 0, userId: payment.userId, description: '' };

        await em.getRepository(Subscription).update(
          { id: subscription.id },
          {
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: emUmMes(),
            creditsGrantedAt: new Date(),
          },
        );

        const plan = PLANS[subscription.planCode];
        return {
          credits: plan.monthlyCredits,
          userId: payment.userId,
          description: `Plano ${plan.name}`,
        };
      }

      return { credits: 0, userId: payment.userId, description: '' };
    });

    if (credits <= 0) return 0;

    // A concessão sai da transação do pagamento de propósito: o ledger tem a
    // própria transação com lock de carteira, e aninhar as duas aumentaria a
    // janela de contenção sobre a linha da carteira.
    const bucket = description.startsWith('Plano') ? 'plan' : 'pack';
    await this.credits.grant(
      userId,
      credits,
      bucket,
      bucket === 'plan' ? 'plan_renewal' : 'pack_purchase',
      description,
    );

    this.logger.log(`${credits} créditos concedidos a ${userId} (${description}).`);
    return credits;
  }

  private async findPayment(event: WebhookEvent): Promise<Payment | null> {
    const repo = this.dataSource.getRepository(Payment);
    if (event.externalReference) {
      const byRef = await repo.findOneBy({ id: event.externalReference });
      if (byRef) return byRef;
    }
    if (event.paymentRef) {
      const byProvider = await repo.findOneBy({ providerRef: event.paymentRef });
      if (byProvider) return byProvider;
    }
    if (event.subscriptionRef) {
      const subscription = await this.dataSource
        .getRepository(Subscription)
        .findOneBy({ providerRef: event.subscriptionRef });
      if (subscription) {
        return repo.findOne({
          where: { subscriptionId: subscription.id },
          order: { createdAt: 'DESC' },
        });
      }
    }
    return null;
  }

  private async userOf(userId: string): Promise<User> {
    const user = await this.dataSource.getRepository(User).findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return user;
  }
}

function emUmMes(): Date {
  const data = new Date();
  data.setMonth(data.getMonth() + 1);
  return data;
}
