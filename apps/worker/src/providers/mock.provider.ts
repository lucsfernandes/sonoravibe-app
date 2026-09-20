import { spawn } from 'node:child_process';
import {
  CREDIT_COSTS,
  MusicProviderError,
  type GenerationKind,
  type MusicGenerationRequest,
  type MusicGenerationResult,
  type MusicProvider,
} from '@sonora/shared';

/**
 * Provider de desenvolvimento: sintetiza áudio com FFmpeg em vez de chamar a IA.
 *
 * Existe para que todo o resto do sistema — fila, ledger de créditos, upload no
 * R2, SSE, player, download em lote — possa ser desenvolvido e testado sem
 * gastar um centavo de crédito da OpenRouter. O áudio é uma progressão de
 * acordes simples derivada de um hash do prompt, então prompts diferentes
 * soam diferentes e o mesmo prompt soa igual (útil em teste).
 */
export class MockMusicProvider implements MusicProvider {
  readonly id = 'mock';
  readonly displayName = 'Mock (desenvolvimento)';
  readonly maxDurationSeconds = 180;
  readonly supportedKinds: readonly GenerationKind[] = [
    'song',
    'clip',
    'extend',
    'remix',
    'cover',
    'replace_section',
    'remaster',
  ];

  constructor(private readonly ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg') {}

  estimateCredits(req: MusicGenerationRequest): number {
    return req.kind === 'clip' ? CREDIT_COSTS.clip : CREDIT_COSTS.song;
  }

  async generate(req: MusicGenerationRequest): Promise<MusicGenerationResult> {
    const seconds = Math.min(
      req.kind === 'clip' ? 30 : req.durationSeconds || 30,
      this.maxDurationSeconds,
    );

    // Simula a latência real para que a UI de progresso seja exercitada de verdade.
    await delay(1500);

    const frequencies = chordFromPrompt(req.prompt);
    const audio = await this.synthesize(frequencies, seconds);

    return {
      audio: { kind: 'buffer', data: audio },
      sourceFormat: 'flac',
      durationMs: seconds * 1000,
      providerRef: `mock-${hash(req.prompt).toString(16)}`,
      suggestedTitle: undefined,
    };
  }

  /**
   * Gera um acorde sustentado com leve fade in/out.
   * `anullsrc` + `sine` é o jeito mais portátil de produzir áudio no FFmpeg sem
   * depender de arquivo de entrada.
   */
  private synthesize(frequencies: number[], seconds: number): Promise<Buffer> {
    const inputs = frequencies.flatMap((freq) => [
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`,
    ]);

    const mixInputs = frequencies.map((_, i) => `[${i}:a]`).join('');
    const filter =
      `${mixInputs}amix=inputs=${frequencies.length}:duration=longest,` +
      `volume=0.25,afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, seconds - 1.2)}:d=1.2`;

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputs,
      '-filter_complex',
      filter,
      '-ac',
      '2',
      '-ar',
      '48000',
      // FLAC 24 bits, igual ao que o ACE-Step entrega: o mock precisa exercitar
      // o mesmo caminho de master do motor real, senão esconde problemas de
      // formato que só apareceriam em produção.
      '-c:a',
      'flac',
      '-sample_fmt',
      's32',
      '-f',
      'flac',
      'pipe:1',
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args);
      const chunks: Buffer[] = [];
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) =>
        reject(
          new MusicProviderError(
            `Não foi possível executar o FFmpeg em "${this.ffmpegPath}". ` +
              `Instale o FFmpeg ou defina FFMPEG_PATH.`,
            this.id,
            false,
            err,
          ),
        ),
      );

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(
            new MusicProviderError(
              `FFmpeg saiu com código ${code}: ${stderr.slice(0, 500)}`,
              this.id,
              false,
            ),
          );
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
  }
}

/** Escolhe um acorde determinístico a partir do prompt. */
function chordFromPrompt(prompt: string): number[] {
  const roots = [220, 246.94, 261.63, 293.66, 329.63, 349.23, 392]; // A3..G4
  const root = roots[hash(prompt) % roots.length];
  const minor = hash(prompt) % 2 === 0;
  return [
    root,
    root * (minor ? 1.1892 : 1.2599), // terça menor ou maior
    root * 1.4983, // quinta justa
    root * 2, // oitava
  ];
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
