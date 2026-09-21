import { Inject, Injectable } from '@nestjs/common';
import { Subscription } from '@sonora/db';
import { type AudioFormat, type Plan, type PlanCode } from '@sonora/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { PlansRepository } from './plans.repository';

/**
 * De qual plano um usuário é, agora.
 *
 * O plano em si vem de `PlansRepository`, que lê da tabela `plans` e mantém em
 * memória. Aqui resolvemos só a pergunta "qual código", que depende da
 * assinatura ativa em `subscriptions`.
 */
@Injectable()
export class PlansService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly planos: PlansRepository,
  ) {}

  async planCodeOf(userId: string): Promise<PlanCode> {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
      select: { id: true, planCode: true, currentPeriodEnd: true },
    });

    if (!subscription) return 'free';

    // Assinatura vencida que ainda não foi processada pelo webhook: o acesso
    // cai para Free na hora, em vez de esperar o gateway avisar.
    if (subscription.currentPeriodEnd && subscription.currentPeriodEnd < new Date()) {
      return 'free';
    }
    return subscription.planCode;
  }

  async planOf(userId: string): Promise<Plan> {
    return this.planos.porCodigo(await this.planCodeOf(userId));
  }

  /**
   * O plano libera este formato de download?
   *
   * Lê a lista do plano carregado do banco, e não mais a constante do código:
   * liberar um formato passa a ser um UPDATE, não um deploy.
   */
  async canDownload(planCode: PlanCode, format: AudioFormat): Promise<boolean> {
    const plano = await this.planos.porCodigo(planCode);
    return plano.features.downloadFormats.includes(format);
  }
}
