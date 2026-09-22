import { Song } from '@sonora/db';
import {
  AUDIO_FORMAT_SPECS,
  PROGRESS_CHANNEL,
  STATUS_PROGRESS,
  WAVEFORM_POINTS,
  type GenerationProgressMessage,
  type ImportJob,
  type MasterFormat,
} from '@sonora/shared';
import { StorageService, storageKeys } from '@sonora/storage';
import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import { peaksOfBuffer, transcodeBuffer } from '../audio/ffmpeg';

/**
 * Importa um áudio enviado pelo usuário (arquivo ou gravação do microfone).
 *
 * A faixa já existe no banco em `uploading`, criada pela API ao receber o
 * arquivo. Aqui o bruto vira master: MP3 fica MP3 (copiar o stream não perde
 * nada e preserva o que o arquivo trazia); todo o resto vira FLAC, que é o
 * master dos motores e o que o restante do sistema espera. A duração é medida
 * no arquivo convertido e a forma de onda sai junto, porque os bytes já estão
 * aqui.
 *
 * Não custa crédito e não há linha em `generations`: o evento de progresso
 * usa o id da própria faixa, como a edição mecânica faz.
 */
export class ImportProcessor {
  constructor(
    private readonly deps: {
      dataSource: DataSource;
      storage: StorageService;
      redis: Redis;
      ffmpegPath: string;
      logger?: { log(msg: string): void };
    },
  ) {}

  private get logger() {
    return this.deps.logger ?? console;
  }

  async process(job: ImportJob): Promise<void> {
    const repo = this.deps.dataSource.getRepository(Song);
    const song = await repo.findOneBy({ id: job.songId });
    if (!song) throw new Error(`Faixa ${job.songId} não existe.`);
    // Retry do BullMQ depois de um sucesso: a faixa já está pronta.
    if (song.status === 'complete' && song.masterKey) return;

    try {
      const bruto = await this.deps.storage.getObject(job.sourceKey);
      const master: MasterFormat = job.extension === 'mp3' ? 'mp3' : 'flac';
      const args = master === 'mp3' ? ['-codec:a', 'copy'] : ['-codec:a', 'flac'];

      const { data, durationMs } = await transcodeBuffer(
        bruto,
        job.extension,
        master,
        // `-vn` descarta qualquer trilha de vídeo: uma gravação WebM do
        // navegador pode vir com um canal de vídeo vazio que o FLAC recusa.
        ['-vn', ...args],
        this.deps.ffmpegPath,
      );

      const key = storageKeys.master(song.id, master);
      await this.deps.storage.putObject(key, data, AUDIO_FORMAT_SPECS[master].mimeType);

      const waveform = await peaksOfBuffer(data, master, this.deps.ffmpegPath, WAVEFORM_POINTS);

      await repo.update(
        { id: song.id },
        { status: 'complete', masterKey: key, durationMs, waveform, providerId: 'upload' },
      );

      // O bruto já cumpriu o papel; manter os dois dobraria o armazenamento.
      await this.deps.storage.deleteObject(job.sourceKey).catch(() => undefined);

      await this.publish(job, 'complete', {
        id: song.id,
        title: song.title,
        durationMs,
        audioUrl: await this.deps.storage.presignGet(key),
        coverUrl: null,
      });

      this.logger.log(
        `Upload ${song.id} importado: ${Math.round(durationMs / 1000)}s, master ${master}`,
      );
    } catch (err) {
      await repo.update({ id: song.id }, { status: 'failed' });
      await this.publish(job, 'failed', undefined, (err as Error).message);
      throw err;
    }
  }

  private async publish(
    job: ImportJob,
    status: 'complete' | 'failed',
    song?: GenerationProgressMessage['song'],
    error?: string,
  ): Promise<void> {
    const message: GenerationProgressMessage = {
      userId: job.userId,
      generationId: job.songId,
      songId: job.songId,
      status,
      progress: STATUS_PROGRESS[status],
      ...(song ? { song } : {}),
      ...(error ? { error } : {}),
    };
    await this.deps.redis.publish(PROGRESS_CHANNEL, JSON.stringify(message));
  }
}
