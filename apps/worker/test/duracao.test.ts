import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { durationOfBuffer } from '../src/audio/ffmpeg';

/**
 * A duração das músicas do Lyria é medida aqui, não informada pelo provedor.
 *
 * Isto foi escrito depois de um bug em produção: o `lyria.provider` devolve
 * `durationMs: 0` porque a API do Google não informa duração, e o processador
 * gravava esse 0 direto no banco. A primeira música gerada em produção tinha
 * 180s reais e aparecia como "0:00", com todo download estimado em "~0 MB".
 *
 * O teste usa áudio de verdade — gerado pelo próprio FFmpeg — porque o que
 * quebrou foi justamente a medição, não a lógica ao redor dela.
 */

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * A checagem precisa ser síncrona e no topo do módulo: `skipIf` é avaliado
 * quando o vitest coleta os testes, antes de qualquer `beforeAll` rodar.
 */
const temFfmpeg = ((): boolean => {
  try {
    execFileSync(ffmpegPath, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let dir: string;

/** Gera um tom senoidal de `segundos` no formato pedido. */
async function gerarTom(segundos: number, extensao: string, args: string[]): Promise<Buffer> {
  const caminho = join(dir, `tom-${segundos}s-${extensao}-${args.join('')}.${extensao}`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${segundos}`,
      ...args,
      caminho,
    ]);
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
  return readFile(caminho);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sonora-teste-duracao-'));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('durationOfBuffer', () => {
  it.skipIf(!temFfmpeg)('mede um MP3 de bitrate constante', async () => {
    const audio = await gerarTom(3, 'mp3', ['-b:a', '128k']);
    const ms = await durationOfBuffer(audio, 'mp3', ffmpegPath);

    // Tolerância de 100ms: o MP3 acrescenta padding de quadro no fim.
    expect(ms).toBeGreaterThan(2900);
    expect(ms).toBeLessThan(3200);
  });

  it.skipIf(!temFfmpeg)('mede um MP3 de bitrate variável', async () => {
    // O caso que motivou gravar em arquivo em vez de usar `pipe:0`: sem seek,
    // o ffprobe estima a duração de um VBR pelo primeiro quadro e erra.
    const audio = await gerarTom(4, 'mp3', ['-q:a', '0']);
    const ms = await durationOfBuffer(audio, 'mp3', ffmpegPath);

    expect(ms).toBeGreaterThan(3900);
    expect(ms).toBeLessThan(4200);
  });

  it.skipIf(!temFfmpeg)('mede um FLAC, que é o master do ACE-Step', async () => {
    const audio = await gerarTom(2, 'flac', []);
    const ms = await durationOfBuffer(audio, 'flac', ffmpegPath);

    expect(ms).toBeGreaterThan(1900);
    expect(ms).toBeLessThan(2100);
  });

  it('devolve 0 em vez de explodir quando o binário não existe', async () => {
    // Duração é informativa. Se o ffprobe sumir do container, a música ainda
    // tem que ser salva — o usuário perde o "3:01" na tela, não a música.
    const ms = await durationOfBuffer(Buffer.from('nem-audio-e'), 'mp3', '/nao/existe/ffmpeg');
    expect(ms).toBe(0);
  });

  it('devolve 0 para bytes que não são áudio', async () => {
    const ms = await durationOfBuffer(Buffer.alloc(1024), 'mp3', ffmpegPath);
    expect(ms).toBe(0);
  });
});
