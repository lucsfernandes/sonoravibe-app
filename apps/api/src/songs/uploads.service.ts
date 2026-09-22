import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Song, Workspace } from '@sonora/db';
import { DEFAULT_JOB_OPTIONS, JOB_NAMES, jobId, type ImportJob } from '@sonora/shared';
import { StorageService } from '@sonora/storage';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { EDIT_QUEUE } from '../queue/queue.module';
import { STORAGE } from '../storage/storage.module';
import { LibraryService, type SongSummary } from './library.service';

/**
 * Tipos de áudio aceitos, com a extensão que cada um vira no R2.
 *
 * `video/webm` entra porque é o que o MediaRecorder do Chrome produz ao gravar
 * só áudio; `application/octet-stream` é o que um navegador manda quando não
 * reconhece a extensão, e aí a extensão do nome do arquivo decide.
 */
const EXTENSIONS_BY_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
};

const KNOWN_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'ogg', 'opus', 'webm', 'm4a', 'aac']);

/** Teto por arquivo. Um WAV de 10 minutos tem ~100 MB; acima disso é outra conversa. */
export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

/**
 * Áudio enviado pelo usuário: arquivo do computador ou gravação do microfone.
 *
 * Vira uma faixa da biblioteca como qualquer outra, só que do tipo `upload`:
 * aparece na lista, toca no player e serve de referência no "+ Áudio". O
 * arquivo bruto vai para o R2 do jeito que chegou e o worker converte para o
 * master em segundo plano; enquanto isso a faixa fica em `uploading`, com a
 * barra de progresso no card, e o SSE avisa quando terminar.
 *
 * Não custa crédito: não há motor envolvido, só FFmpeg no nosso worker.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(EDIT_QUEUE) private readonly editQueue: Queue,
    private readonly library: LibraryService,
  ) {}

  async receive(
    userId: string,
    file: Buffer,
    contentType: string | undefined,
    filename: string | undefined,
    workspaceId: string | undefined,
  ): Promise<SongSummary> {
    if (!file || file.byteLength === 0) {
      throw new BadRequestException('O arquivo chegou vazio.');
    }
    if (file.byteLength > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `O arquivo tem ${(file.byteLength / 1024 / 1024).toFixed(1)} MB; o máximo é ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      );
    }

    const extension = extensionOf(contentType, filename);
    if (!extension) {
      throw new BadRequestException(
        'Formato não reconhecido. Envie MP3, WAV, FLAC, OGG, Opus, M4A, AAC ou uma gravação WebM.',
      );
    }

    const workspace = await this.resolveWorkspace(userId, workspaceId);
    const repo = this.dataSource.getRepository(Song);
    const song = await repo.save(
      repo.create({
        userId,
        workspaceId: workspace,
        title: titleOf(filename),
        stylePrompt: null,
        instrumental: false,
        status: 'uploading',
        kind: 'upload',
        providerId: 'upload',
      }),
    );

    const sourceKey = `songs/${song.id}/upload.${extension}`;
    await this.storage.putObject(sourceKey, file, contentType || 'application/octet-stream');

    const job: ImportJob = { songId: song.id, userId, sourceKey, extension };
    await this.editQueue.add(JOB_NAMES.import, job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: jobId(song.id, 'import'),
    });

    this.logger.log(
      `Upload ${song.id} recebido (${(file.byteLength / 1024 / 1024).toFixed(1)} MB, .${extension})`,
    );
    return this.library.toSummary(song);
  }

  private async resolveWorkspace(userId: string, requested?: string): Promise<string | null> {
    const repo = this.dataSource.getRepository(Workspace);
    if (requested) {
      const owned = await repo.findOne({ where: { id: requested, userId }, select: { id: true } });
      if (!owned) throw new BadRequestException('Workspace não encontrado na sua conta.');
      return owned.id;
    }
    const fallback = await repo.findOne({ where: { userId, isDefault: true }, select: { id: true } });
    return fallback?.id ?? null;
  }
}

/** Extensão a partir do tipo declarado; sem tipo útil, a do nome do arquivo. */
export function extensionOf(contentType?: string, filename?: string): string | null {
  const tipo = contentType?.split(';')[0]?.trim().toLowerCase();
  if (tipo && EXTENSIONS_BY_TYPE[tipo]) return EXTENSIONS_BY_TYPE[tipo];

  const doNome = filename?.split('.').pop()?.trim().toLowerCase();
  if (doNome && KNOWN_EXTENSIONS.has(doNome)) return doNome;
  return null;
}

/** O nome do arquivo sem extensão vira o título; uma gravação sem nome ganha um. */
export function titleOf(filename?: string): string {
  const semExtensao = filename?.replace(/\.[a-z0-9]+$/i, '').trim();
  return (semExtensao || 'Gravação').slice(0, 160);
}
