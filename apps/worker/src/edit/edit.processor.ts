import { Song } from '@sonora/db';
import {
  AUDIO_FORMAT_SPECS,
  PROGRESS_CHANNEL,
  STATUS_PROGRESS,
  type EditJob,
  type GenerationProgressMessage,
  type MasterFormat,
} from '@sonora/shared';
import { StorageService, storageKeys } from '@sonora/storage';
import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';
import { transcodeBuffer } from '../audio/ffmpeg';
import { argsForOperation } from '../audio/operations';

/**
 * Edições mecânicas: corte, fade, velocidade, reverter, normalizar.
 *
 * Cada edição gera uma faixa NOVA, com `parentSongId` apontando para a
 * original. Sobrescrever o master seria mais simples e destrutivo: um fade-out
 * mal calculado apagaria a gravação boa sem volta.
 *
 * Não consome crédito — roda em FFmpeg aqui dentro, sem provedor externo.
 */
export class EditProcessor {
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

  async process(job: EditJob): Promise<void> {
    const repo = this.deps.dataSource.getRepository(Song);
    const parent = await repo.findOneBy({ id: job.songId });
    if (!parent?.masterKey) {
      throw new Error(`Música ${job.songId} não tem master para editar.`);
    }

    const master = (parent.masterKey.endsWith('.mp3') ? 'mp3' : 'flac') as MasterFormat;
    const { args, label } = argsForOperation(job.operation, job.params, parent.durationMs);

    const derived = await repo.save(
      repo.create({
        userId: job.userId,
        workspaceId: parent.workspaceId,
        parentSongId: parent.id,
        title: `${parent.title} (${label})`.slice(0, 160),
        stylePrompt: parent.stylePrompt,
        excludeStyles: parent.excludeStyles,
        lyrics: parent.lyrics,
        instrumental: parent.instrumental,
        status: 'uploading',
        kind: 'edit',
        params: parent.params,
        providerId: 'ffmpeg',
      }),
    );

    await this.publish(job, derived.id, 'uploading');

    try {
      const entrada = await this.deps.storage.getObject(parent.masterKey);
      const { data, durationMs } = await transcodeBuffer(
        entrada,
        master,
        master,
        // Mesmo codec do master: a edição não deve introduzir perda de geração.
        [...args, ...codecArgsFor(master)],
        this.deps.ffmpegPath,
      );

      const key = storageKeys.master(derived.id, master);
      await this.deps.storage.putObject(key, data, AUDIO_FORMAT_SPECS[master].mimeType);

      await repo.update(
        { id: derived.id },
        {
          status: 'complete',
          masterKey: key,
          // A duração medida no arquivo, e não a calculada: corte e mudança de
          // velocidade mexem nela, e um número errado desalinha o player.
          durationMs: durationMs || parent.durationMs,
        },
      );

      await this.publish(job, derived.id, 'complete', {
        id: derived.id,
        title: derived.title,
        durationMs: durationMs || parent.durationMs,
        audioUrl: await this.deps.storage.presignGet(key),
        coverUrl: parent.coverKey ? await this.deps.storage.presignGet(parent.coverKey) : null,
      });

      this.logger.log(`Edição '${job.operation}' de ${parent.id} -> ${derived.id} (${label})`);
    } catch (err) {
      await repo.update({ id: derived.id }, { status: 'failed' });
      await this.publish(job, derived.id, 'failed', undefined, (err as Error).message);
      throw err;
    }
  }

  private async publish(
    job: EditJob,
    songId: string,
    status: 'uploading' | 'complete' | 'failed',
    song?: GenerationProgressMessage['song'],
    error?: string,
  ): Promise<void> {
    const message: GenerationProgressMessage = {
      userId: job.userId,
      // Edição não cria linha em `generations` (não há cobrança nem provedor),
      // então o id da própria faixa identifica o evento para a interface.
      generationId: songId,
      songId,
      status,
      progress: STATUS_PROGRESS[status],
      ...(song ? { song } : {}),
      ...(error ? { error } : {}),
    };
    await this.deps.redis.publish(PROGRESS_CHANNEL, JSON.stringify(message));
  }
}

/** Reencoda no mesmo formato do master, sem trocar de codec. */
function codecArgsFor(master: MasterFormat): string[] {
  return master === 'flac'
    ? ['-codec:a', 'flac', '-sample_fmt', 's32']
    : ['-codec:a', 'libmp3lame', '-b:a', '320k'];
}
