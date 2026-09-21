import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Song, Stem } from '@sonora/db';
import {
  AUDIO_FORMAT_SPECS,
  PROGRESS_CHANNEL,
  type GenerationProgressMessage,
  type StemKind,
  type StemsJob,
} from '@sonora/shared';
import { StorageService, storageKeys } from '@sonora/storage';
import type { Redis } from 'ioredis';
import type { DataSource } from 'typeorm';

/**
 * Separação de stems com Demucs (htdemucs).
 *
 * Roda num processo à parte porque o Demucs é Python e consome bastante CPU e
 * memória — por isso ele tem fila própria, com concorrência baixa: duas
 * separações simultâneas num nó pequeno derrubam o pod por falta de memória.
 *
 * Exige o `demucs` disponível no PATH da imagem do worker. Sem ele, a falha é
 * explícita na primeira execução, e não um erro obscuro de arquivo ausente.
 */

/** Nomes que o Demucs dá aos arquivos, na ordem do modelo htdemucs. */
const DEMUCS_STEMS: Record<string, StemKind> = {
  vocals: 'vocals',
  drums: 'drums',
  bass: 'bass',
  other: 'other',
};

export class StemsProcessor {
  constructor(
    private readonly deps: {
      dataSource: DataSource;
      storage: StorageService;
      redis: Redis;
      demucsPath: string;
      logger?: { log(msg: string): void; warn(msg: string): void };
    },
  ) {}

  private get logger() {
    return this.deps.logger ?? console;
  }

  async process(job: StemsJob): Promise<void> {
    const song = await this.deps.dataSource.getRepository(Song).findOneBy({ id: job.songId });
    if (!song?.masterKey) {
      throw new Error(`Música ${job.songId} não tem master para separar.`);
    }

    const dir = await mkdtemp(join(tmpdir(), 'sonora-stems-'));
    const inputPath = join(dir, `master.${song.masterKey.split('.').pop() ?? 'flac'}`);

    try {
      await writeFile(inputPath, await this.deps.storage.getObject(song.masterKey));

      const started = Date.now();
      await this.runDemucs(inputPath, dir);

      const produzidos = await this.collect(dir);
      if (produzidos.length === 0) {
        throw new Error('O Demucs rodou mas não produziu nenhum stem.');
      }

      const repo = this.deps.dataSource.getRepository(Stem);
      const salvos: StemKind[] = [];

      for (const { kind, path } of produzidos) {
        // Só o que foi pedido: separar tudo e subir tudo gastaria armazenamento
        // com faixas que o usuário nem abriu.
        if (!job.kinds.includes(kind)) continue;

        const data = await readFile(path);
        const key = storageKeys.stem(job.songId, kind);
        await this.deps.storage.putObject(key, data, AUDIO_FORMAT_SPECS.flac.mimeType);

        await repo.upsert(
          { songId: job.songId, kind, storageKey: key, sizeBytes: String(data.byteLength) },
          ['songId', 'kind'],
        );
        salvos.push(kind);
      }

      await this.publish(job, 'complete');
      this.logger.log(
        `Stems de ${job.songId}: ${salvos.join(', ')} em ${Math.round((Date.now() - started) / 1000)}s`,
      );
    } catch (err) {
      await this.publish(job, 'failed', (err as Error).message);
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runDemucs(inputPath: string, outDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.deps.demucsPath, [
        // Sem `--two-stems`: o htdemucs entrega as quatro faixas (voz, bateria,
        // baixo e o resto), que é o que a interface oferece.
        ...['-n', 'htdemucs'],
        // FLAC na saída: stem é material de trabalho, e reencodar em MP3 aqui
        // jogaria fora qualidade logo antes de o usuário abrir numa DAW.
        '--flac',
        ...['-o', outDir],
        inputPath,
      ]);

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err) =>
        reject(
          new Error(
            `Não consegui executar '${this.deps.demucsPath}': ${err.message}. ` +
              'A imagem do worker precisa ter o Demucs instalado.',
          ),
        ),
      );
      proc.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Demucs saiu com código ${code}: ${stderr.slice(-1500)}`)),
      );
    });
  }

  /** Varre a saída do Demucs, que aninha em <out>/<modelo>/<nome-da-faixa>/. */
  private async collect(dir: string): Promise<{ kind: StemKind; path: string }[]> {
    const encontrados: { kind: StemKind; path: string }[] = [];

    const visitar = async (caminho: string, profundidade: number): Promise<void> => {
      if (profundidade > 4) return;
      for (const entry of await readdir(caminho, { withFileTypes: true })) {
        const filho = join(caminho, entry.name);
        if (entry.isDirectory()) {
          await visitar(filho, profundidade + 1);
          continue;
        }
        const base = entry.name.replace(/\.(flac|wav|mp3)$/i, '');
        const kind = DEMUCS_STEMS[base];
        if (kind) encontrados.push({ kind, path: filho });
      }
    };

    await visitar(dir, 0);
    return encontrados;
  }

  private async publish(job: StemsJob, status: 'complete' | 'failed', error?: string): Promise<void> {
    const message: GenerationProgressMessage = {
      userId: job.userId,
      generationId: `${job.songId}:stems`,
      songId: job.songId,
      status,
      progress: 100,
      ...(error ? { error } : {}),
    };
    await this.deps.redis.publish(PROGRESS_CHANNEL, JSON.stringify(message));
  }
}
