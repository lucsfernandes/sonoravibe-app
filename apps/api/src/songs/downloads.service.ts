import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { Song, SongRendition } from '@sonora/db';
import {
  AUDIO_FORMAT_SPECS,
  DEFAULT_JOB_OPTIONS,
  RENDITION_CACHE_DAYS,
  ffmpegArgsFor,
  formatLabel,
  jobId,
  mp3ArgsFor,
  renditionBitrate,
  type AudioFormat,
  type Plan,
  type TranscodeJob,
} from '@sonora/shared';
import { StorageService } from '@sonora/storage';
import { Queue } from 'bullmq';
import type { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { PlansService } from '../plans/plans.service';
import { TRANSCODE_QUEUE } from '../queue/queue.module';
import { STORAGE } from '../storage/storage.module';
import { LibraryService, masterFormatOf } from './library.service';

export type DownloadResult =
  | { ready: true; url: string; filename: string }
  | { ready: false; retryAfterSeconds: number; message: string };

export interface BatchEntry {
  song: Song;
  storageKey: string;
  filename: string;
}

/**
 * Downloads.
 *
 * Só o MP3 é gerado assim que a música fica pronta. WAV, FLAC, OPUS e M4A são
 * transcodificados quando alguém pede e ficam em cache por
 * RENDITION_CACHE_DAYS — guardar os cinco formatos de toda música multiplicaria
 * o armazenamento por cerca de cinco, e a grande maioria nunca é baixada.
 *
 * Quando o formato ainda não existe, a resposta é 202 com Retry-After em vez de
 * segurar a requisição HTTP aberta esperando o FFmpeg: uma música de 8 minutos
 * demora o bastante para estourar timeout de proxy.
 */
@Injectable()
export class DownloadsService {
  private readonly logger = new Logger(DownloadsService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(TRANSCODE_QUEUE) private readonly transcode: Queue,
    private readonly library: LibraryService,
    private readonly plans: PlansService,
  ) {}

  async download(userId: string, songId: string, format: AudioFormat): Promise<DownloadResult> {
    const song = await this.library.own(userId, songId);
    const plan = await this.plans.planOf(userId);

    this.assertDownloadable(song, plan, format);

    const bitrate = renditionBitrate(format, plan.features.mp3Quality);
    const key = await this.resolveKey(song, format, bitrate, plan.features.mp3Quality, userId);

    if (!key) {
      return {
        ready: false,
        retryAfterSeconds: 5,
        message: `Convertendo para ${formatLabel(format, plan.features.mp3Quality)}. Tente de novo em alguns segundos.`,
      };
    }

    const filename = filenameFor(song, format);
    return { ready: true, url: await this.storage.presignGet(key, 3600, filename), filename };
  }

  /**
   * Prepara o lote. Devolve as faixas prontas ou, se faltar alguma, o que ainda
   * está convertendo — o ZIP é montado só quando tudo existe, para o usuário não
   * receber um arquivo pela metade sem perceber.
   */
  async prepareBatch(
    userId: string,
    songIds: string[],
    format: AudioFormat,
  ): Promise<{ ready: true; entries: BatchEntry[] } | { ready: false; pending: string[] }> {
    const plan = await this.plans.planOf(userId);
    if (!plan.features.batchDownload) {
      throw new ForbiddenException(
        'Download em lote é exclusivo dos planos pagos. Baixe uma de cada vez ou faça upgrade.',
      );
    }

    const songs = await this.library.ownMany(userId, songIds);
    const bitrate = renditionBitrate(format, plan.features.mp3Quality);

    const entries: BatchEntry[] = [];
    const pending: string[] = [];

    for (const song of songs) {
      this.assertDownloadable(song, plan, format);
      const key = await this.resolveKey(song, format, bitrate, plan.features.mp3Quality, userId);
      if (key) entries.push({ song, storageKey: key, filename: filenameFor(song, format) });
      else pending.push(song.id);
    }

    return pending.length > 0 ? { ready: false, pending } : { ready: true, entries };
  }

  /** Stream de leitura de um objeto, para o ZIP. */
  streamOf(storageKey: string): Promise<Readable> {
    return this.storage.getObjectStream(storageKey);
  }

  private assertDownloadable(song: Song, plan: Plan, format: AudioFormat): void {
    if (song.status !== 'complete' || !song.masterKey) {
      throw new ForbiddenException('Esta música ainda não terminou de gerar.');
    }
    if (!this.plans.canDownload(plan.code, format)) {
      const liberados = plan.features.downloadFormats
        .map((f) => formatLabel(f, plan.features.mp3Quality))
        .join(', ');
      throw new ForbiddenException(
        `Seu plano baixa ${liberados}. ` +
          `${formatLabel(format, plan.features.mp3Quality)} está disponível nos planos pagos.`,
      );
    }
  }

  /**
   * A chave do arquivo pronto, ou null quando a conversão foi enfileirada.
   * Enfileirar é idempotente: o jobId é derivado de música+formato+bitrate, e o
   * BullMQ descarta um job com id repetido — clicar cinco vezes no botão não
   * converte cinco vezes.
   */
  private async resolveKey(
    song: Song,
    format: AudioFormat,
    bitrate: number,
    mp3Quality: 'preview' | 'full',
    userId: string,
  ): Promise<string | null> {
    const master = masterFormatOf(song.masterKey);

    // O formato pedido é o próprio master: serve o arquivo original. Vale
    // principalmente para o MP3 do Lyria, que carrega o manifesto C2PA — um
    // reencode apagaria a credencial de origem do áudio.
    if (format === master && (format !== 'mp3' || mp3Quality === 'full')) {
      return song.masterKey;
    }

    const existing = await this.dataSource
      .getRepository(SongRendition)
      .findOneBy({ songId: song.id, format, bitrate });

    if (existing) {
      const ainda = await this.storage.statObject(existing.storageKey);
      if (ainda) return existing.storageKey;
      // A linha ficou, o arquivo expirou no R2: limpa e reconverte.
      await this.dataSource.getRepository(SongRendition).delete({ id: existing.id });
    }

    const job: TranscodeJob = {
      songId: song.id,
      userId,
      format,
      bitrate,
      ffmpegArgs: format === 'mp3' ? mp3ArgsFor(mp3Quality) : ffmpegArgsFor(format, master),
    };

    await this.transcode.add('transcode', job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: jobId(song.id, format, bitrate),
    });

    this.logger.log(`Conversão enfileirada: ${song.id} -> ${format} ${bitrate || ''}`);
    return null;
  }
}

/** Nome amigável do arquivo baixado, seguro para qualquer sistema de arquivos. */
export function filenameFor(song: Song, format: AudioFormat): string {
  const base =
    song.title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60)
      // O corte em 60 cai no meio de uma palavra e deixa o hífen solto no fim
      // ("...voz-masculina-grave-.mp3"). Apara as pontas depois de cortar.
      .replace(/^-+|-+$/g, '') || 'sonora';
  return `${base}.${format}`;
}

export { RENDITION_CACHE_DAYS };
