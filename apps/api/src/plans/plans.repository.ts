import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Plan as PlanRow } from '@sonora/db';
import { PLANS, type Plan, type PlanCode } from '@sonora/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';

/**
 * Os planos vendáveis, lidos do banco e mantidos em memória.
 *
 * Por que banco: preço e texto de venda mudam com frequência, e cada mudança
 * não deveria custar build, push e rollout. Por que memória: `queuePriority` e
 * `maxConcurrentGenerations` são lidos a cada geração; uma ida ao Postgres nesse
 * caminho não compra nada — os planos mudam algumas vezes por ano, não por
 * segundo.
 *
 * O cache é carregado no boot e revalidado a cada `TTL_MS`. Não há invalidação
 * ativa de propósito: um UPDATE direto no banco (que é o caso de uso) não tem
 * como avisar a aplicação, e um minuto de atraso num preço é aceitável. Quem
 * quiser efeito imediato reinicia o pod.
 *
 * `plans.ts` continua sendo a semente e o fallback. Banco vazio não pode
 * significar "não existe plano": significaria API no ar recusando toda geração
 * por não saber o que o usuário pode fazer.
 */
@Injectable()
export class PlansRepository implements OnModuleInit {
  private readonly logger = new Logger(PlansRepository.name);
  private cache = new Map<PlanCode, Plan>();
  private carregadoEm = 0;

  /**
   * De onde vieram os planos que estão em memória agora.
   *
   * Existe para ser observável de fora. Os valores do banco e os do código são
   * iguais por construção (um é semente do outro), então nenhuma resposta da
   * API denuncia qual dos dois está em uso — e a diferença importa muito: no
   * fallback, mudar preço por UPDATE não tem efeito nenhum.
   */
  private origem: 'banco' | 'codigo' = 'codigo';

  /** Um minuto: curto para o preço novo aparecer, longo para não pesar. */
  private static readonly TTL_MS = 60_000;

  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.semear();
    await this.recarregar();
  }

  /** Todos os planos à venda, na ordem de exibição. */
  async listar(): Promise<Plan[]> {
    await this.garantirFresco();
    return [...this.cache.values()];
  }

  /** 'banco' ou 'codigo'. Ver o campo `origem`. */
  async origemAtual(): Promise<'banco' | 'codigo'> {
    await this.garantirFresco();
    return this.origem;
  }

  /**
   * Um plano pelo código.
   *
   * Nunca devolve `undefined`: um código desconhecido cai no Free. O alternativo
   * seria estourar no meio de uma geração porque alguém desativou um plano que
   * ainda tem assinante.
   */
  async porCodigo(code: PlanCode): Promise<Plan> {
    await this.garantirFresco();
    return this.cache.get(code) ?? PLANS[code] ?? PLANS.free;
  }

  private async garantirFresco(): Promise<void> {
    if (Date.now() - this.carregadoEm < PlansRepository.TTL_MS) return;
    await this.recarregar();
  }

  private async recarregar(): Promise<void> {
    try {
      const linhas = await this.dataSource.getRepository(PlanRow).find({
        where: { isActive: true },
        order: { sortOrder: 'ASC' },
      });

      if (linhas.length === 0) {
        // Tabela vazia é situação de banco novo, não de "nenhum plano à venda".
        this.usarCodigo('tabela `plans` vazia');
        return;
      }

      this.cache = new Map(linhas.map((l) => [l.code as PlanCode, paraPlano(l)]));
      this.origem = 'banco';
      this.carregadoEm = Date.now();
    } catch (err) {
      // Postgres fora do ar não pode derrubar a API inteira: sem plano, nenhuma
      // geração passa na validação, e o usuário vê "erro" no lugar de "o
      // catálogo demorou".
      this.usarCodigo(`falha ao ler do banco: ${(err as Error).message}`);
    }
  }

  private usarCodigo(motivo: string): void {
    this.logger.warn(`Usando os planos do código (${motivo}).`);
    this.cache = new Map(Object.entries(PLANS) as [PlanCode, Plan][]);
    this.origem = 'codigo';
    this.carregadoEm = Date.now();
  }

  /**
   * Insere os planos do código quando a tabela está vazia.
   *
   * Idempotente e não destrutivo: só cria o que falta, nunca sobrescreve. É o
   * que permite rodar no boot de todo pod sem desfazer um preço ajustado à mão.
   */
  private async semear(): Promise<void> {
    const repo = this.dataSource.getRepository(PlanRow);
    try {
      if ((await repo.count()) > 0) return;

      const ordem: PlanCode[] = ['free', 'pro', 'premier'];
      await repo.insert(
        ordem.map((code, i) => {
          const plano = PLANS[code];
          return {
            code,
            name: plano.name,
            priceBrl: plano.priceBrl.toFixed(2),
            monthlyCredits: plano.monthlyCredits,
            cycleCredits: plano.cycleCredits ?? null,
            cycleDays: plano.cycleDays ?? null,
            isHighlighted: code === 'pro',
            sortOrder: i,
            isActive: true,
            features: plano.features,
          };
        }),
      );
      this.logger.log(`Tabela \`plans\` semeada com ${ordem.length} planos.`);
    } catch (err) {
      // Dois pods subindo juntos disputam o insert; o segundo falha na chave
      // primária e está tudo certo — o primeiro já semeou.
      this.logger.warn(`Não semeei os planos: ${(err as Error).message}`);
    }
  }
}

/** Linha do banco no formato que o resto do sistema já consome. */
function paraPlano(linha: PlanRow): Plan {
  return {
    code: linha.code as PlanCode,
    name: linha.name,
    // `numeric` volta do Postgres como string para não perder precisão.
    priceBrl: Number(linha.priceBrl),
    monthlyCredits: linha.monthlyCredits,
    ...(linha.cycleCredits ? { cycleCredits: linha.cycleCredits } : {}),
    ...(linha.cycleDays ? { cycleDays: linha.cycleDays } : {}),
    features: linha.features,
  };
}
