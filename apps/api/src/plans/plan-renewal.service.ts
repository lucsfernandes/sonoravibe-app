import { Inject, Injectable, Logger } from '@nestjs/common';
import { CreditTransaction, CreditWallet } from '@sonora/db';
import type { PlanCode } from '@sonora/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { CreditsService } from '../credits/credits.service';
import { PlansRepository } from './plans.repository';

/**
 * Renova a cota do plano gratuito.
 *
 * Isto não existia. A concessão acontecia uma única vez, no cadastro
 * (`onboarding.service.ts`), e o comentário de lá dizia que o usuário "só
 * espera o próximo ciclo" — só que ciclo nenhum existia. Na prática: o usuário
 * criava a conta, ganhava a cota, gerava três músicas e nunca mais recebia um
 * crédito. A interface anunciava "30 créditos por dia" o tempo todo.
 *
 * A renovação é sob demanda, não por CronJob. O motivo é que o gatilho é a
 * visita: só faz sentido creditar quem voltou. Um cron creditaria todas as
 * contas do banco a cada ciclo, incluindo as abandonadas, e o custo de
 * infraestrutura de um crédito não gasto é o mesmo de um gasto — alguém
 * precisa ter a GPU disponível para ele.
 *
 * O último `plan_renewal` do próprio ledger é o relógio. Não há coluna
 * `ultima_renovacao` para ficar fora de sincronia com o extrato que o usuário
 * lê: se o crédito está no extrato, foi concedido.
 */
@Injectable()
export class PlanRenewalService {
  private readonly logger = new Logger(PlanRenewalService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly credits: CreditsService,
    private readonly planos: PlansRepository,
  ) {}

  /**
   * Concede a cota se o ciclo virou. Seguro chamar a cada requisição.
   *
   * Devolve quantos créditos entraram, ou 0 quando ainda não é hora.
   */
  async renovarSeVirouCiclo(userId: string, planCode: PlanCode): Promise<number> {
    try {
      return await this.conceder(userId, planCode);
    } catch (err) {
      // Nada aqui pode derrubar a leitura de saldo.
      //
      // Isto quebrou em produção: a versão anterior consultava a tabela
      // `plans` direto, e como o cluster sobe com `DB_SYNCHRONIZE=false` a
      // tabela ainda não existia. O erro subia e `GET /credits` devolvia 500 —
      // a rota que a interface chama em TODO carregamento de página, então o
      // aplicativo inteiro parecia quebrado por causa de um crédito não
      // concedido.
      //
      // Renovação é benefício, não requisito: falhar aqui custa ao usuário
      // esperar o próximo ciclo. Falhar o saldo custa o produto.
      this.logger.error(`Não renovei a cota de ${userId}: ${(err as Error).message}`);
      return 0;
    }
  }

  private async conceder(userId: string, planCode: PlanCode): Promise<number> {
    // Pelo repositório, e não pela tabela: ele já cai nos planos do código
    // quando o banco não responde. Duas portas para o mesmo dado significam
    // duas chances de divergir.
    const plano = await this.planos.porCodigo(planCode);
    const creditos = plano.cycleCredits ?? 0;
    const dias = plano.cycleDays ?? 0;

    // Plano pago não renova por aqui: os créditos dele entram na cobrança,
    // quando o gateway confirma o pagamento.
    if (creditos <= 0 || dias <= 0) return 0;

    const limite = new Date(Date.now() - dias * 24 * 3600 * 1000);

    // O ledger indexa por carteira, não por usuário: a carteira é 1:1 com a
    // conta, e é ela que serializa as escritas concorrentes.
    const carteira = await this.dataSource.getRepository(CreditWallet).findOne({
      where: { userId },
      select: { id: true },
    });
    if (!carteira) return 0;

    const ultima = await this.dataSource.getRepository(CreditTransaction).findOne({
      where: { walletId: carteira.id, reason: 'plan_renewal' },
      order: { createdAt: 'DESC' },
      select: { id: true, createdAt: true },
    });

    if (ultima && ultima.createdAt > limite) return 0;

    try {
      await this.credits.grant(userId, creditos, 'plan', 'plan_renewal', rotuloDoCiclo(dias));
      this.logger.log(`Cota de ${creditos} créditos renovada para ${userId} (${dias}d).`);
      return creditos;
    } catch (err) {
      // Duas abas abertas disputando a renovação: a segunda falha e tudo bem,
      // a primeira já creditou. Concedido a mais seria pior que a mais tarde.
      this.logger.warn(`Não renovei a cota de ${userId}: ${(err as Error).message}`);
      return 0;
    }
  }
}

function rotuloDoCiclo(dias: number): string {
  if (dias === 1) return 'Cota diária do Free';
  if (dias >= 28 && dias <= 31) return 'Cota mensal do Free';
  return `Cota do Free (${dias} dias)`;
}
