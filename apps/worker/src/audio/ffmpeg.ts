import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Execução do FFmpeg sobre arquivos temporários.
 *
 * Usar arquivo e não pipe é deliberado: FLAC e M4A precisam voltar para
 * reescrever o cabeçalho no fim do arquivo, e em `pipe:1` o FFmpeg falha com
 * "muxer does not support non seekable output". Áudio de até 8 minutos cabe
 * folgado em disco temporário.
 */

export interface FfmpegResult {
  data: Buffer;
  durationMs: number;
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

export async function transcodeBuffer(
  input: Buffer,
  inputExtension: string,
  outputExtension: string,
  args: readonly string[],
  ffmpegPath = 'ffmpeg',
): Promise<FfmpegResult> {
  const dir = await mkdtemp(join(tmpdir(), 'sonora-'));
  const inputPath = join(dir, `in.${inputExtension}`);
  const outputPath = join(dir, `out.${outputExtension}`);

  try {
    await writeFile(inputPath, input);
    await run(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, ...args, outputPath],
    );
    const data = await readFile(outputPath);
    return { data, durationMs: await durationOf(outputPath, ffmpegPath) };
  } finally {
    // Sem isso o diretório temporário se acumula a cada conversão e, num pod de
    // vida longa, acaba enchendo o disco do nó.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Duração real do arquivo, medida com ffprobe. */
export async function durationOf(path: string, ffmpegPath = 'ffmpeg'): Promise<number> {
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m) =>
    m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe',
  );
  try {
    const out = await run(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ]);
    const seconds = Number.parseFloat(out.trim());
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
  } catch {
    // Duração é informativa: se o ffprobe não estiver disponível, a conversão
    // continua valendo. Melhor 0 do que derrubar o download inteiro.
    return 0;
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) =>
      reject(new FfmpegError(`Não consegui executar '${command}': ${err.message}`, stderr)),
    );
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new FfmpegError(`${command} saiu com código ${code}`, stderr.slice(-2000)));
    });
  });
}
