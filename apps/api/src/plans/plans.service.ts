import { Inject, Injectable } from '@nestjs/common';
import { Subscription } from '@sonora/db';
import {
  PLANS,
  canDownloadFormat,
  type AudioFormat,
  type Plan,
  type PlanCode,
} from '@sonora/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';

/**
 * De qual plano um usuário é, agora.
 *
 * Os planos vivem em código (`@sonora/shared`), não em tabela: preço e limites
 * mudam por deploy, com revisão, e não por UPDATE solto no banco. A tabela
 * `subscriptions` guarda só o vínculo com o gateway de pagamento.
 */
@Injectable()
export class PlansService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

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
    return PLANS[await this.planCodeOf(userId)];
  }

  /** O plano libera este formato de download? */
  canDownload(planCode: PlanCode, format: AudioFormat): boolean {
    return canDownloadFormat(planCode, format);
  }
}
