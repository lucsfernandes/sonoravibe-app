import {
  AUDIO_FORMAT_SPECS,
  DEFAULT_JOB_OPTIONS,
  EAGER_FORMATS,
  PROGRESS_CHANNEL,
  STATUS_PROGRESS,
  ffmpegArgsFor,
  jobId,
  mp3ArgsFor,
  renditionBitrate,
  type TranscodeJob,
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
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import type { MusicRouter } from '../providers/music-router';
import { durationOfBuffer } from '../audio/ffmpeg';
import type { CoverArtGenerator } from './cover-art';

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
  /** Fila de conversão, para já deixar o MP3 pronto quando a música nasce. */
  transcodeQueue: Queue;
  coverArt: CoverArtGenerator;
  /** Usado para medir a duração quando o provedor não informa. Ver `resolveDuration`. */
  ffmpegPath: string;
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

    // A capa é um job próprio e não passa pelo motor de música.
    if (job.kind === 'cover') {
      await this.processCover(job, song);
      return;
    }

    await this.transition(job, 'compiling_prompt');

    try {
      const request = await this.buildRequest(song, job);

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
      const durationMs = await this.resolveDuration(result, master);

      // O título do modelo só entra se o usuário não tiver escolhido um. Quem
      // digitou o nome da música espera vê-lo de volta — e o que o Lyria manda
      // nem sempre é um nome: já chegou a ser o mapa de seções da faixa.
      const titulo =
        job.titleFromUser || !result.suggestedTitle
          ? undefined
          : result.suggestedTitle.slice(0, 160);

      await this.deps.dataSource.transaction(async (em) => {
        await em.getRepository(Song).update(
          { id: songId },
          {
            status: 'complete',
            masterKey,
            durationMs,
            providerId: result.servedBy,
            compiledPrompt: request.prompt,
            ...(titulo ? { title: titulo } : {}),
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

      await this.enqueueEagerFormats(songId, userId, master);

      await this.publish({
        userId,
        generationId,
        songId,
        status: 'complete',
        progress: STATUS_PROGRESS.complete,
        song: {
          id: songId,
          title: titulo ?? song.title,
          durationMs,
          audioUrl: await this.deps.storage.presignGet(masterKey),
          coverUrl: null,
        },
      });

      const viaReserva = result.fallbackReason ? ` (reserva: ${result.fallbackReason})` : '';
      this.logger.log(
        `Geração ${generationId} concluída por ${result.servedBy}: ` +
          `${Math.round(durationMs / 1000)}s de áudio${viaReserva}`,
      );

      // A capa vem DEPOIS de a música ser publicada, de propósito. Ela é
      // enfeite: quem pediu uma música quer ouvir, e esperar mais 10 segundos
      // por uma imagem atrasaria o que importa. Como o evento de conclusão já
      // saiu, o usuário toca a faixa enquanto a capa é desenhada, e um segundo
      // evento a coloca no lugar quando ficar pronta.
      await this.gerarCapa(song, request.prompt);
    } catch (err) {
      await this.fail(job, err);
      throw err; // devolve ao BullMQ para ele decidir sobre o retry
    }
  }

  /**
   * Já deixa o MP3 pronto, sem esperar alguém clicar em baixar.
   *
   * É o formato que a maioria baixa e o único do plano Free: convertê-lo agora
   * troca uma espera visível (usuário parado na tela de download) por trabalho
   * de fundo. Os demais formatos continuam sob demanda, porque guardar os cinco
   * de toda música multiplicaria o armazenamento à toa.
   *
   * Falha aqui não derruba a geração: a música está pronta e a API reconverte
   * quando alguém pedir.
   */
  private async enqueueEagerFormats(
    songId: string,
    userId: string,
    master: MasterFormat,
  ): Promise<void> {
    for (const format of EAGER_FORMATS) {
      // O master já É o formato: não há o que converter.
      if (format === master) continue;

      const bitrate = renditionBitrate(format, 'full');
      const eager: TranscodeJob = {
        songId,
        userId,
        format,
        bitrate,
        ffmpegArgs: format === 'mp3' ? mp3ArgsFor('full') : ffmpegArgsFor(format, master),
      };

      await this.deps.transcodeQueue
        .add('transcode', eager, {
          ...DEFAULT_JOB_OPTIONS,
          jobId: jobId(songId, format, bitrate),
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Não enfileirei o ${format} de ${songId}: ${(err as Error).message}`,
          );
        });
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

  /**
   * Gera só a capa e grava na própria música.
   *
   * Falhar aqui estorna o crédito da capa, mas não toca no áudio: a música
   * continua pronta e tocável, só sem arte.
   */
  private async processCover(job: GenerationJob, song: Song): Promise<void> {
    await this.transition(job, 'generating_cover');

    try {
      if (!this.deps.coverArt.available) {
        throw new Error('Geração de capa indisponível: OPENROUTER_API_KEY não configurada.');
      }

      const resultado = await this.deps.coverArt.generate(
        job.coverPrompt ?? song.stylePrompt ?? song.title,
      );
      if (!resultado) throw new Error('O modelo de imagem não devolveu nenhuma capa.');

      const key = storageKeys.cover(song.id);
      await this.deps.storage.putObject(key, resultado.data, resultado.mimeType);

      await this.deps.dataSource.transaction(async (em) => {
        await em.getRepository(Song).update({ id: song.id }, { coverKey: key });
        await em.getRepository(Generation).update(
          { id: job.generationId },
          { status: 'complete', providerId: 'openrouter-image', finishedAt: new Date() },
        );
      });

      await this.deps.credits.commit(job.userId, job.reservedCredits);

      await this.publish({
        userId: job.userId,
        generationId: job.generationId,
        songId: song.id,
        status: 'complete',
        progress: STATUS_PROGRESS.complete,
        song: {
          id: song.id,
          title: song.title,
          durationMs: song.durationMs,
          audioUrl: song.masterKey ? await this.deps.storage.presignGet(song.masterKey) : '',
          coverUrl: await this.deps.storage.presignGet(key),
        },
      });

      this.logger.log(`Capa de ${song.id} pronta.`);
    } catch (err) {
      await this.fail(job, err);
      throw err;
    }
  }

  /** Traduz a música gravada no banco para o pedido que o motor entende. */
  private async buildRequest(song: Song, job: GenerationJob): Promise<MusicGenerationRequest> {
    const controls = (song.params ?? {}) as Partial<AdvancedControls> & {
      sectionStartMs?: number;
      sectionEndMs?: number;
      addSeconds?: number;
    };

    // Derivadas precisam ouvir a faixa original. A URL é assinada e curta: o
    // motor roda fora do cluster e não tem credencial do nosso bucket.
    let sourceAudioUrl: string | undefined;
    if (job.sourceSongId) {
      const origem = await this.deps.dataSource
        .getRepository(Song)
        .findOneBy({ id: job.sourceSongId });
      if (!origem?.masterKey) {
        throw new Error(`A faixa de origem ${job.sourceSongId} não tem áudio.`);
      }
      sourceAudioUrl = await this.deps.storage.presignGet(origem.masterKey, 3600);
    }

    return {
      ...(sourceAudioUrl ? { sourceAudioUrl } : {}),
      ...(controls.sectionStartMs !== undefined
        ? { sectionStartMs: controls.sectionStartMs, sectionEndMs: controls.sectionEndMs }
        : {}),
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
  /**
   * Desenha a capa a partir do mesmo prompt que gerou a música.
   *
   * Não cobra crédito: é parte do mesmo pedido. Cobrar duas vezes por um
   * clique é o tipo de surpresa que faz o usuário desconfiar da fatura.
   *
   * Nada aqui pode derrubar a geração. A música já está gravada, commitada e
   * publicada quando isto roda; uma falha no modelo de imagem custa uma capa,
   * e o card cai no gradiente com a inicial do título, que é o que já acontece
   * hoje em toda música. Por isso o try/catch engole tudo e só registra.
   */
  private async gerarCapa(song: Song, prompt: string): Promise<void> {
    if (!this.deps.coverArt.available) return;

    try {
      const resultado = await this.deps.coverArt.generate(prompt);
      if (!resultado) return;

      const key = storageKeys.cover(song.id);
      await this.deps.storage.putObject(key, resultado.data, resultado.mimeType);
      await this.deps.dataSource.getRepository(Song).update({ id: song.id }, { coverKey: key });

      // Segundo evento de conclusão, agora com a capa. A interface recarrega a
      // música e a imagem entra no lugar do gradiente.
      await this.publish({
        userId: song.userId,
        generationId: song.id,
        songId: song.id,
        status: 'complete',
        progress: STATUS_PROGRESS.complete,
        song: {
          id: song.id,
          title: song.title,
          durationMs: song.durationMs,
          audioUrl: '',
          coverUrl: await this.deps.storage.presignGet(key),
        },
      });

      this.logger.log(`Capa de ${song.id} pronta.`);
    } catch (err) {
      this.logger.warn(`Não desenhei a capa de ${song.id}: ${(err as Error).message}`);
    }
  }

  /**
   * Duração real da música, em milissegundos.
   *
   * O Lyria não informa duração nenhuma e devolve 0. Aceitar esse 0 deixa a
   * música com "0:00" na tela e todo download estimado em "~0 MB" — foi
   * exatamente o que aconteceu com a primeira música gerada em produção, cujo
   * arquivo tinha 180s e 2,8 MB de verdade. Quando o provedor não diz, medimos.
   *
   * Só dá para medir o que passou por aqui: quando o motor de GPU sobe o master
   * direto para o R2, o buffer nunca chega ao worker. Esse caminho é o
   * ACE-Step, que informa `duration_ms` corretamente, então não há perda.
   *
   * Duração é informativa, nunca motivo para perder a música: se o ffprobe
   * falhar, `durationOfBuffer` devolve 0 e a geração continua valendo.
   */
  private async resolveDuration(
    result: {
      durationMs: number;
      audio: { kind: 'buffer'; data: Buffer } | { kind: 'stored'; storageKey: string };
    },
    master: MasterFormat,
  ): Promise<number> {
    if (result.durationMs > 0) return result.durationMs;
    if (result.audio.kind !== 'buffer') return 0;

    const medido = await durationOfBuffer(result.audio.data, master, this.deps.ffmpegPath);
    if (medido === 0) {
      this.logger.warn(
        'O provedor não informou a duração e o ffprobe não conseguiu medir; ' +
          'a música fica com 0:00 na interface.',
      );
    }
    return medido;
  }

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
