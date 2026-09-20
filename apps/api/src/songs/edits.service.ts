import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { Generation, Song } from '@sonora/db';
import {
  CREDIT_COSTS,
  DEFAULT_JOB_OPTIONS,
  jobId,
  type AdvancedControls,
  type EditJob,
  type EditOperation,
  type GenerationJob,
  type GenerationKind,
  type StemKind,
  type StemsJob,
} from '@sonora/shared';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { CreditsService, InsufficientCreditsError } from '../credits/credits.service';
import { DATA_SOURCE } from '../database/database.module';
import { PlansService } from '../plans/plans.service';
import { GENERATION_QUEUE, STEMS_QUEUE, EDIT_QUEUE } from '../queue/queue.module';
import { insufficientCredits } from './songs.service';
import { LibraryService } from './library.service';

export interface DerivedResult {
  songId: string;
  generationId: string;
  creditsCharged: number;
  status: 'queued';
}

/**
 * Operações sobre uma música que já existe.
 *
 * Dois grupos, com regras de cobrança diferentes:
 *
 *  - **Derivadas** (estender, remix, substituir trecho, capa) chamam o motor de
 *    novo e custam crédito. Cada uma nasce como uma Song nova com
 *    `parentSongId` apontando para a original — a linhagem de uma faixa vira
 *    uma árvore, e o usuário não perde a versão anterior.
 *  - **Mecânicas** (cortar, fade, velocidade, reverter, normalizar, stems) só
 *    rodam FFmpeg ou Demucs no nosso worker. Não custam crédito, porque não há
 *    custo de provedor — cobrar por elas seria cobrar por nada.
 */
@Injectable()
export class EditsService {
  private readonly logger = new Logger(EditsService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(GENERATION_QUEUE) private readonly generationQueue: Queue,
    @Inject(EDIT_QUEUE) private readonly editQueue: Queue,
    @Inject(STEMS_QUEUE) private readonly stemsQueue: Queue,
    private readonly credits: CreditsService,
    private readonly plans: PlansService,
    private readonly library: LibraryService,
  ) {}

  /** Continua a música por mais alguns segundos. */
  extend(userId: string, songId: string, addSeconds: number): Promise<DerivedResult> {
    return this.derive(userId, songId, 'extend', CREDIT_COSTS.extend, (parent) => ({
      title: `${parent.title} (estendida)`,
      params: { ...(parent.params ?? {}), addSeconds },
    }));
  }

  /** Regera com outro estilo, mantendo a letra. */
  remix(userId: string, songId: string, styles: string): Promise<DerivedResult> {
    return this.derive(userId, songId, 'remix', CREDIT_COSTS.remix, (parent) => ({
      title: `${parent.title} (remix)`,
      stylePrompt: styles,
    }));
  }

  /** Substitui uma janela específica da faixa. */
  replaceSection(
    userId: string,
    songId: string,
    data: { startMs: number; endMs: number; styles?: string },
  ): Promise<DerivedResult> {
    if (data.endMs <= data.startMs) {
      throw new ForbiddenException('O fim do trecho precisa vir depois do início.');
    }
    return this.derive(
      userId,
      songId,
      'replace_section',
      CREDIT_COSTS.replaceSection,
      (parent) => ({
        title: parent.title,
        ...(data.styles ? { stylePrompt: data.styles } : {}),
        params: {
          ...(parent.params ?? {}),
          sectionStartMs: data.startMs,
          sectionEndMs: data.endMs,
        },
      }),
    );
  }

  /** Gera a capa da música. Não cria faixa nova: escreve na própria. */
  async coverArt(userId: string, songId: string, prompt?: string): Promise<{ generationId: string }> {
    const song = await this.library.own(userId, songId);
    if (song.status !== 'complete') {
      throw new ForbiddenException('A música ainda não terminou de gerar.');
    }

    const generation = await this.dataSource.getRepository(Generation).save(
      this.dataSource.getRepository(Generation).create({
        songId,
        userId,
        kind: 'cover',
        status: 'queued',
        providerId: 'pending',
        creditsCharged: CREDIT_COSTS.cover,
      }),
    );

    await this.reserveOrFail(userId, CREDIT_COSTS.cover, generation.id, songId);

    const job: GenerationJob = {
      generationId: generation.id,
      songId,
      userId,
      kind: 'cover',
      reservedCredits: CREDIT_COSTS.cover,
      coverPrompt: prompt ?? song.stylePrompt ?? song.title,
    };
    await this.generationQueue.add('cover', job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: generation.id,
    });

    return { generationId: generation.id };
  }

  /**
   * Edição mecânica — corte, fade, velocidade, reverter, normalizar.
   * Sem crédito: é FFmpeg no nosso worker, sem chamada a provedor.
   */
  async edit(
    userId: string,
    songId: string,
    operation: EditOperation,
    params: Record<string, number>,
  ): Promise<{ status: 'queued'; operation: EditOperation }> {
    const song = await this.library.own(userId, songId);
    if (song.status !== 'complete' || !song.masterKey) {
      throw new ForbiddenException('A música ainda não terminou de gerar.');
    }

    const job: EditJob = { songId, userId, operation, params };
    await this.editQueue.add('edit', job, {
      ...DEFAULT_JOB_OPTIONS,
      // Uma edição por operação de cada vez na mesma música: dois cortes
      // simultâneos sobre o mesmo master competiriam pelo arquivo de saída.
      jobId: jobId(songId, operation),
    });

    this.logger.log(`Edição '${operation}' enfileirada para ${songId}`);
    return { status: 'queued', operation };
  }

  /** Separação de stems com Demucs. Sem crédito, mas exclusiva de planos pagos. */
  async stems(
    userId: string,
    songId: string,
    kinds: StemKind[],
  ): Promise<{ status: 'queued'; kinds: StemKind[] }> {
    const plan = await this.plans.planOf(userId);
    if (!plan.features.stems) {
      throw new ForbiddenException(
        'Separação de stems é exclusiva dos planos pagos. Faça upgrade para liberar.',
      );
    }

    const song = await this.library.own(userId, songId);
    if (song.status !== 'complete' || !song.masterKey) {
      throw new ForbiddenException('A música ainda não terminou de gerar.');
    }

    const job: StemsJob = { songId, userId, kinds };
    await this.stemsQueue.add('stems', job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: jobId(songId, 'stems'),
      // O Demucs é pesado: uma tentativa a mais gastaria minutos de CPU para
      // provavelmente falhar do mesmo jeito.
      attempts: 2,
    });

    return { status: 'queued', kinds };
  }

  /**
   * Cria a faixa derivada, reserva o crédito e enfileira.
   *
   * Mesma ordem da geração original — e pelo mesmo motivo: sem a reserva antes
   * da fila, dez remixes entrariam com saldo para um.
   */
  private async derive(
    userId: string,
    parentId: string,
    kind: GenerationKind,
    cost: number,
    build: (parent: Song) => Partial<Song> & { params?: Record<string, unknown> },
  ): Promise<DerivedResult> {
    const parent = await this.library.own(userId, parentId);

    if (parent.status !== 'complete' || !parent.masterKey) {
      throw new ForbiddenException('A música original ainda não terminou de gerar.');
    }

    const patch = build(parent);

    const { song, generation } = await this.dataSource.transaction(async (em) => {
      const song = await em.getRepository(Song).save(
        em.getRepository(Song).create({
          userId,
          workspaceId: parent.workspaceId,
          parentSongId: parent.id,
          title: (patch.title ?? parent.title).slice(0, 160),
          stylePrompt: patch.stylePrompt ?? parent.stylePrompt,
          excludeStyles: parent.excludeStyles,
          lyrics: parent.lyrics,
          instrumental: parent.instrumental,
          status: 'queued',
          kind,
          params: (patch.params ?? parent.params) as Partial<AdvancedControls> | null,
        }),
      );

      const generation = await em.getRepository(Generation).save(
        em.getRepository(Generation).create({
          songId: song.id,
          userId,
          kind,
          status: 'queued',
          providerId: 'pending',
          creditsCharged: cost,
        }),
      );

      return { song, generation };
    });

    await this.reserveOrFail(userId, cost, generation.id, song.id);

    const plan = await this.plans.planOf(userId);
    const job: GenerationJob = {
      generationId: generation.id,
      songId: song.id,
      userId,
      kind,
      reservedCredits: cost,
      sourceSongId: parent.id,
    };

    await this.generationQueue.add(kind, job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: generation.id,
      priority: plan.features.queuePriority,
    });

    this.logger.log(`${kind} de ${parent.id} -> ${song.id} (${cost} créditos)`);
    return { songId: song.id, generationId: generation.id, creditsCharged: cost, status: 'queued' };
  }

  private async reserveOrFail(
    userId: string,
    cost: number,
    generationId: string,
    songId: string,
  ): Promise<void> {
    try {
      await this.credits.reserve(userId, cost, generationId);
    } catch (err) {
      await this.dataSource.transaction(async (em) => {
        await em.getRepository(Generation).update(
          { id: generationId },
          {
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
            finishedAt: new Date(),
          },
        );
        await em.getRepository(Song).update({ id: songId }, { status: 'failed' });
      });
      if (err instanceof InsufficientCreditsError) throw insufficientCredits(err);
      throw err;
    }
  }
}
