import {
  AUDIO_FORMAT_SPECS,
  PROGRESS_CHANNEL,
  STATUS_PROGRESS,
  type AudioFormat,
  type GenerationJob,
  type GenerationProgressMessage,
  type GenerationStatus,
  type MasterFormat,
  type MusicGenerationRequest,
  type AdvancedControls,
} from '@sonora/shared';
import { CreditsLedger, Generation, Song } from '@sonora/db';
import { StorageService, storageKeys } from '@sonora/storage';
import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import type { MusicRouter } from '../providers/music-router';

/**
 * O que acontece com um job de geração, do início ao fim.
 *
 * Três garantias norteiam o código abaixo:
 *
 *  1. O usuário vê progresso. Cada etapa publica no canal do Redis que
 *     alimenta o SSE — uma geração de 3 minutos sem sinal nenhum é
 *     indistinguível de uma geração travada.
 *  2. Crédito reservado não fica preso. Sucesso confirma, falha estorna, e o
 *     estorno é idempotente para o retry do BullMQ não devolver duas vezes.
 *  3. Cancelamento é respeitado. Um job pode ter sido cancelado enquanto
 *     esperava na fila; conferimos antes de gastar dinheiro com o provedor.
 */

/** O ACE-Step entrega FLAC 24 bits; o Lyria só devolve MP3. */
const MASTER_BY_SOURCE: Record<string, MasterFormat> = { flac: 'flac', mp3: 'mp3' };

/**
 * Traduz o formato devolvido pelo motor para o formato do master.
 *
 * Sem `??` de conveniência: um formato desconhecido virando 'flac' por padrão
 * grava um arquivo com a extensão e o Content-Type errados, e o usuário só
 * descobre no download. Já aconteceu — um WAV foi parar no R2 como
 * `master.flac`. Falhar aqui aponta direto para o provider defeituoso.
 */
function masterFormatOf(sourceFormat: string, providerId: string): MasterFormat {
  const master = MASTER_BY_SOURCE[sourceFormat];
  if (!master) {
    throw new Error(
      `O motor '${providerId}' devolveu formato '${sourceFormat}', que não serve como master ` +
        `(esperado: ${Object.keys(MASTER_BY_SOURCE).join(' ou ')}).`,
    );
  }
  return master;
}

export interface ProcessorDeps {
  dataSource: DataSource;
  storage: StorageService;
  redis: Redis;
  router: MusicRouter;
  credits: CreditsLedger;
  logger?: { log(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export class GenerationProcessor {
  private readonly logger: NonNullable<ProcessorDeps['logger']>;

  constructor(private readonly deps: ProcessorDeps) {
    this.logger = deps.logger ?? console;
  }

  async process(job: GenerationJob): Promise<void> {
    const { generationId, songId, userId } = job;

    const { generation, song } = await this.load(generationId, songId);

    // Cancelado enquanto esperava na fila: não chamamos o provedor. O estorno
    // já foi feito por quem cancelou.
    if (generation.status === 'canceled') {
      this.logger.log(`Geração ${generationId} cancelada antes de rodar; nada a fazer.`);
      return;
    }

    await this.transition(job, 'compiling_prompt');

    try {
      const request = this.buildRequest(song);

      // O destino no R2 é assinado antes de chamar o motor: o worker de GPU
      // roda fora do cluster e sobe o master direto, sem passar o arquivo por
      // aqui (um FLAC de 4 min estoura o limite de resposta da RunPod).
      const provisionalKey = storageKeys.master(songId, 'flac');
      const uploadUrl = await this.deps.storage.presignPut(
        provisionalKey,
        AUDIO_FORMAT_SPECS.flac.mimeType,
      );
      request.uploadTarget = {
        url: uploadUrl,
        storageKey: provisionalKey,
        contentType: AUDIO_FORMAT_SPECS.flac.mimeType,
      };

      await this.transition(job, 'generating_audio');
      const result = await this.deps.router.generate(request);

      await this.transition(job, 'uploading');
      const master = masterFormatOf(result.sourceFormat, result.servedBy);
      const masterKey = await this.storeAudio(songId, master, result.audio);

      await this.deps.dataSource.transaction(async (em) => {
        await em.getRepository(Song).update(
          { id: songId },
          {
            status: 'complete',
            masterKey,
            durationMs: result.durationMs,
            providerId: result.servedBy,
            compiledPrompt: request.prompt,
            ...(result.suggestedTitle ? { title: result.suggestedTitle.slice(0, 160) } : {}),
          },
        );
        await em.getRepository(Generation).update(
          { id: generationId },
          {
            status: 'complete',
            providerId: result.servedBy,
            providerRef: result.providerRef ?? null,
            compiledPrompt: request.prompt,
            finishedAt: new Date(),
          },
        );
      });

      // Só agora o crédito sai da reserva: até aqui, qualquer falha estornava.
      await this.deps.credits.commit(userId, job.reservedCredits);

      await this.publish({
        userId,
        generationId,
        songId,
        status: 'complete',
        progress: STATUS_PROGRESS.complete,
        song: {
          id: songId,
          title: result.suggestedTitle?.slice(0, 160) ?? song.title,
          durationMs: result.durationMs,
          audioUrl: await this.deps.storage.presignGet(masterKey),
          coverUrl: null,
        },
      });

      const viaReserva = result.fallbackReason ? ` (reserva: ${result.fallbackReason})` : '';
      this.logger.log(
        `Geração ${generationId} concluída por ${result.servedBy} em ${result.durationMs}ms${viaReserva}`,
      );
    } catch (err) {
      await this.fail(job, err);
      throw err; // devolve ao BullMQ para ele decidir sobre o retry
    }
  }

  private async load(
    generationId: string,
    songId: string,
  ): Promise<{ generation: Generation; song: Song }> {
    const [generation, song] = await Promise.all([
      this.deps.dataSource.getRepository(Generation).findOneBy({ id: generationId }),
      this.deps.dataSource.getRepository(Song).findOneBy({ id: songId }),
    ]);
    if (!generation) throw new Error(`Geração ${generationId} não existe.`);
    if (!song) throw new Error(`Música ${songId} não existe.`);
    return { generation, song };
  }

  /** Traduz a música gravada no banco para o pedido que o motor entende. */
  private buildRequest(song: Song): MusicGenerationRequest {
    const controls = (song.params ?? {}) as Partial<AdvancedControls>;

    return {
      kind: song.kind,
      prompt: song.stylePrompt ?? song.title,
      lyrics: song.instrumental ? null : song.lyrics,
      instrumental: song.instrumental,
      durationSeconds: controls.durationSeconds,
      controls: {
        styles: song.stylePrompt ?? undefined,
        excludeStyles: song.excludeStyles ?? undefined,
        vocalGender: controls.vocalGender ?? 'any',
        maxMode: controls.maxMode ?? false,
        weirdness: controls.weirdness ?? 50,
        styleInfluence: controls.styleInfluence ?? 50,
        variety: controls.variety ?? 'high',
        personalize: controls.personalize ?? false,
        bpm: controls.bpm,
        key: controls.key ?? 'any',
        durationSeconds: controls.durationSeconds,
      },
    };
  }

  /**
   * O áudio ou já está no R2 (o motor de GPU subiu direto) ou veio em memória
   * e precisa ser gravado aqui.
   */
  private async storeAudio(
    songId: string,
    master: MasterFormat,
    audio: { kind: 'buffer'; data: Buffer } | { kind: 'stored'; storageKey: string },
  ): Promise<string> {
    if (audio.kind === 'stored') {
      const stat = await this.deps.storage.statObject(audio.storageKey);
      if (!stat || stat.size === 0) {
        throw new Error(
          `O motor disse ter gravado ${audio.storageKey}, mas o objeto não está lá.`,
        );
      }
      return audio.storageKey;
    }

    const key = storageKeys.master(songId, master);
    await this.deps.storage.putObject(
      key,
      audio.data,
      AUDIO_FORMAT_SPECS[master as AudioFormat].mimeType,
    );
    return key;
  }

  /** Grava o status e avisa o navegador, nessa ordem. */
  private async transition(job: GenerationJob, status: GenerationStatus): Promise<void> {
    await this.deps.dataSource.getRepository(Generation).update(
      { id: job.generationId },
      { status, ...(status === 'compiling_prompt' ? { startedAt: new Date() } : {}) },
    );
    await this.deps.dataSource
      .getRepository(Song)
      .update({ id: job.songId }, { status });

    await this.publish({
      userId: job.userId,
      generationId: job.generationId,
      songId: job.songId,
      status,
      progress: STATUS_PROGRESS[status],
    });
  }

  private async fail(job: GenerationJob, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);

    await this.deps.dataSource.transaction(async (em) => {
      await em.getRepository(Generation).update(
        { id: job.generationId },
        { status: 'failed', errorMessage: message, finishedAt: new Date() },
      );
      await em.getRepository(Song).update({ id: job.songId }, { status: 'failed' });
    });

    // Estorno idempotente: se o BullMQ tentar de novo e falhar de novo, o
    // crédito volta uma vez só.
    const { refunded } = await this.deps.credits
      .refund(job.generationId)
      .catch((refundErr: unknown) => {
        this.logger.error(
          `Falhei ao estornar ${job.generationId}: ${(refundErr as Error).message}`,
        );
        return { refunded: 0 };
      });

    await this.publish({
      userId: job.userId,
      generationId: job.generationId,
      songId: job.songId,
      status: 'failed',
      progress: STATUS_PROGRESS.failed,
      error: message,
    });

    this.logger.error(
      `Geração ${job.generationId} falhou (${refunded} créditos estornados): ${message}`,
    );
  }

  private async publish(message: GenerationProgressMessage): Promise<void> {
    await this.deps.redis.publish(PROGRESS_CHANNEL, JSON.stringify(message));
  }
}
