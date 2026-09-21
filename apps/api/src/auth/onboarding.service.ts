import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreditWallet, Profile, Workspace } from '@sonora/db';
import { PLANS } from '@sonora/shared';
import { DataSource, type EntityManager } from 'typeorm';
import { CreditsService } from '../credits/credits.service';
import { DATA_SOURCE } from '../database/database.module';

/**
 * O que acontece logo depois que o Better Auth cria um usuário.
 *
 * Perfil público, workspace padrão e carteira nascem juntos, numa única
 * transação: um usuário sem carteira não consegue gerar nada, e um sem perfil
 * não aparece no Explore. Deixar isso para "quando precisar" espalha checagem
 * de nulo por todo o resto do sistema.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly credits: CreditsService,
  ) {}

  async onUserCreated(user: { id: string; email: string; name: string }): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const handle = await this.pickHandle(em, user.email);

      await em.getRepository(Profile).save(
        em.getRepository(Profile).create({
          userId: user.id,
          handle,
          displayName: user.name?.trim() || handle,
          locale: 'pt-BR',
        }),
      );

      await em.getRepository(Workspace).save(
        em.getRepository(Workspace).create({
          userId: user.id,
          name: 'Meu workspace',
          isDefault: true,
        }),
      );

      const wallet = await em.getRepository(CreditWallet).save(
        em.getRepository(CreditWallet).create({ userId: user.id }),
      );

      this.logger.log(`Usuário ${user.id} pronto: @${handle}, carteira ${wallet.id}`);
    });

    // Primeira cota do Free, fora da transação de onboarding: se a concessão
    // falhar, o cadastro não é desfeito e o `PlanRenewalService` concede na
    // primeira leitura de `/credits`. Sem isto o usuário entraria com carteira
    // zerada e não conseguiria gerar nada na primeira visita, que é justamente
    // quando ele decide se fica.
    const daily = PLANS.free.cycleCredits ?? 0;
    if (daily > 0) {
      try {
        await this.credits.grant(user.id, daily, 'plan', 'plan_renewal', 'Cota mensal do Free');
      } catch (err) {
        this.logger.error(
          `Não concedi a cota inicial de ${user.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Deriva o handle do e-mail e garante unicidade.
   *
   * A verificação aqui evita o caminho de erro no caso comum; a unicidade real
   * é garantida pelo índice único da coluna, que é quem resolve duas pessoas se
   * cadastrando no mesmo instante.
   */
  private async pickHandle(em: EntityManager, email: string): Promise<string> {
    const base =
      email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 30) || 'sonora';

    const repo = em.getRepository(Profile);
    for (let suffix = 0; suffix < 50; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}${suffix}`;
      const taken = await repo.findOne({ where: { handle: candidate }, select: { id: true } });
      if (!taken) return candidate;
    }
    // Esgotou as tentativas amigáveis: cai num sufixo aleatório.
    return `${base}${Math.random().toString(36).slice(2, 8)}`;
  }
}
