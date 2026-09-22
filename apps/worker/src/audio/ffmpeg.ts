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

/**
 * Forma de onda de um áudio em memória: `points` valores de 0 a 1.
 *
 * O FFmpeg reduz o áudio a mono em 4 kHz e despeja as amostras cruas (s16le)
 * num arquivo; daí é só dividir em `points` fatias e guardar o pico de cada
 * uma. 4 kHz é de sobra para um desenho de 120 barras (uma música de 4 min
 * vira ~960 mil amostras, 2 MB) e faz a extração levar menos de um segundo.
 *
 * O resultado é normalizado pelo pico global: uma faixa gravada baixinho no
 * microfone ainda mostra a forma, em vez de uma linha reta. Falha aqui não é
 * motivo para perder nada: quem chama trata `null` como "sem onda".
 */
export async function peaksOfBuffer(
  data: Buffer,
  extension: string,
  ffmpegPath = 'ffmpeg',
  points = 120,
): Promise<number[] | null> {
  const dir = await mkdtemp(join(tmpdir(), 'sonora-peaks-'));
  try {
    const inputPath = join(dir, `audio.${extension}`);
    const pcmPath = join(dir, 'audio.pcm');
    await writeFile(inputPath, data);
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-ac', '1', '-ar', '4000', '-f', 's16le', '-acodec', 'pcm_s16le',
      pcmPath,
    ]);
    const pcm = await readFile(pcmPath);
    return peaksOfPcm(pcm, points);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Divide amostras s16le em `points` fatias e devolve o pico normalizado de cada uma. */
export function peaksOfPcm(pcm: Buffer, points: number): number[] | null {
  const total = Math.floor(pcm.byteLength / 2);
  if (total === 0) return null;

  const porFatia = total / points;
  const picos = new Array<number>(points).fill(0);
  for (let i = 0; i < points; i++) {
    const inicio = Math.floor(i * porFatia);
    const fim = Math.min(total, Math.floor((i + 1) * porFatia));
    let pico = 0;
    for (let s = inicio; s < fim; s++) {
      const v = Math.abs(pcm.readInt16LE(s * 2));
      if (v > pico) pico = v;
    }
    picos[i] = pico;
  }

  const maximo = Math.max(...picos);
  if (maximo === 0) return picos.map(() => 0);
  return picos.map((p) => Math.round((p / maximo) * 1000) / 1000);
}

/**
 * Duração de um áudio que só existe em memória.
 *
 * Passa por arquivo temporário em vez de `pipe:0` porque o ffprobe precisa dar
 * seek para ler o cabeçalho: num MP3 com bitrate variável, sem seek ele estima
 * a duração pelo primeiro quadro e erra feio.
 */
export async function durationOfBuffer(
  data: Buffer,
  extension: string,
  ffmpegPath = 'ffmpeg',
): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'sonora-probe-'));
  try {
    const path = join(dir, `audio.${extension}`);
    await writeFile(path, data);
    return await durationOf(path, ffmpegPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
