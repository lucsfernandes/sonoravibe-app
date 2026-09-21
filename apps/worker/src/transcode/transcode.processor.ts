import { Song, SongRendition } from '@sonora/db';
import {
  AUDIO_FORMAT_SPECS,
  RENDITION_CACHE_DAYS,
  type TranscodeJob,
} from '@sonora/shared';
import { StorageService, storageKeys } from '@sonora/storage';
import type { DataSource } from 'typeorm';
import { transcodeBuffer } from '../audio/ffmpeg';

/**
 * Converte o master para outro formato, sob demanda.
 *
 * Não consome crédito: roda em FFmpeg no nosso próprio worker, sem chamar
 * provedor externo. O custo é CPU, e é por isso que a conversão fica em cache
 * por RENDITION_CACHE_DAYS em vez de acontecer a cada clique no botão.
 */
export class TranscodeProcessor {
  constructor(
    private readonly deps: {
      dataSource: DataSource;
      storage: StorageService;
      ffmpegPath: string;
      logger?: { log(msg: string): void; warn(msg: string): void };
    },
  ) {}

  private get logger() {
    return this.deps.logger ?? console;
  }

  async process(job: TranscodeJob): Promise<void> {
    const song = await this.deps.dataSource.getRepository(Song).findOneBy({ id: job.songId });
    if (!song?.masterKey) {
      throw new Error(`Música ${job.songId} não tem master para converter.`);
    }

    const repo = this.deps.dataSource.getRepository(SongRendition);

    // Outro job pode ter convertido enquanto este esperava na fila.
    const jaExiste = await repo.findOneBy({
      songId: job.songId,
      format: job.format,
      bitrate: job.bitrate,
    });
    if (jaExiste && (await this.deps.storage.statObject(jaExiste.storageKey))) {
      this.logger.log(`${job.songId} já tinha ${job.format}; nada a converter.`);
      return;
    }

    const master = await this.deps.storage.getObject(song.masterKey);
    const masterExtension = song.masterKey.split('.').pop() ?? 'flac';

    const started = Date.now();
    const { data, durationMs } = await transcodeBuffer(
      master,
      masterExtension,
      job.format,
      job.ffmpegArgs,
      this.deps.ffmpegPath,
    );

    const key = storageKeys.rendition(job.songId, job.format, job.bitrate);
    await this.deps.storage.putObject(key, data, AUDIO_FORMAT_SPECS[job.format].mimeType);

    await repo.upsert(
      {
        songId: job.songId,
        format: job.format,
        bitrate: job.bitrate,
        storageKey: key,
        sizeBytes: String(data.byteLength),
        // Cache com validade: o CronJob de limpeza apaga o arquivo depois, e a
        // API reconverte se alguém pedir de novo.
        expiresAt: new Date(Date.now() + RENDITION_CACHE_DAYS * 24 * 3600 * 1000),
      },
      ['songId', 'format', 'bitrate'],
    );

    // Conserta a duração de músicas antigas, de graça.
    //
    // O Lyria não informa duração e, até a correção, esse zero era gravado no
    // banco: a música aparecia como "0:00" e todo download estimado em "~0 MB".
    // A geração nova já mede, mas as músicas que nasceram antes continuariam
    // erradas para sempre.
    //
    // Aqui o valor já foi medido pelo ffprobe para fazer a conversão — gravá-lo
    // não custa nada além de um UPDATE. A condição `durationMs: 0` é o que
    // impede que uma medição ruim sobrescreva um valor bom: só preenche o que
    // está vazio.
    if (song.durationMs === 0 && durationMs > 0) {
      await this.deps.dataSource
        .getRepository(Song)
        .update({ id: job.songId, durationMs: 0 }, { durationMs });
      this.logger.log(`Duração de ${job.songId} preenchida: ${durationMs}ms`);
    }

    this.logger.log(
      `${job.songId} -> ${job.format}${job.bitrate ? ` ${job.bitrate}k` : ''}: ` +
        `${(data.byteLength / 1024 / 1024).toFixed(1)} MB, ${durationMs}ms de áudio, ` +
        `${Date.now() - started}ms de conversão`,
    );
  }
}
