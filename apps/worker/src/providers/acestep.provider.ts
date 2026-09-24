import {
  CREDIT_COSTS,
  MusicProviderError,
  type GenerationKind,
  type GeneratedVariant,
  type MusicGenerationRequest,
  type MusicGenerationResult,
  type MusicProvider,
} from '@sonora/shared';
import {
  buildAceStepNegative,
  compileAceStepCaption,
  excludesVocals,
  toAceStepKeyscale,
} from '../generation/prompt-compiler';

/**
 * ACE-Step 1.5 rodando no worker GPU da RunPod Serverless (apps/gpu-worker).
 *
 * Fluxo: POST /run -> polling em /status/{id} até COMPLETED. O worker sobe o
 * master FLAC 24-bit direto no R2 (URL pré-assinada em `uploadTarget`) e só
 * devolve a chave — a resposta da RunPod é limitada a 10–30 MB.
 *
 * Tempos de referência medidos na L4 com o turbo 2B + LM 1.7B: cold start 56 s,
 * música de 4min30 em 44,8 s. O XL-SFT + LM 4B (50 passos com CFG, duas
 * variantes) NÃO foi medido: é bem mais lento e carrega mais pesos, então os
 * timeouts padrão abaixo têm folga para isso. Quando estouram, o erro é marcado
 * como retentável para o roteador cair no Lyria.
 *
 * Funciona também contra o emulador local do SDK da RunPod
 * (`handler.py --rp_serve_api`), com duas diferenças que o provider tolera:
 * o emulador usa POST em /status, e o job só executa durante essa chamada.
 */

export interface AceStepConfig {
  /** https://api.runpod.ai/v2/<endpointId>, ou http://127.0.0.1:8008 no emulador. */
  baseUrl: string;
  /** Chave da RunPod. O emulador local não exige. */
  apiKey?: string;
  /** A RunPod usa GET em /status; o emulador local do SDK usa POST. */
  statusMethod?: 'GET' | 'POST';
  /** Tempo máximo na fila antes de desistir: sem GPU livre, a reserva atende. */
  queueTimeoutMs?: number;
  /** Tempo máximo total, da submissão ao resultado. */
  totalTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Timeout de cada chamada HTTP. No emulador o /status bloqueia até terminar. */
  requestTimeoutMs?: number;
  /** Injeção para testes. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type RunPodStatus =
  | 'IN_QUEUE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

interface RunPodJob {
  id: string;
  status: RunPodStatus;
  output?: WorkerOutput | { error?: string };
  error?: string;
}

interface WorkerTrack {
  storage_key: string;
  size_bytes: number;
  duration_ms: number;
  format: string;
  sample_rate?: number;
  bit_depth?: number;
  seed?: number;
}

interface WorkerOutput {
  tracks: WorkerTrack[];
  metadata?: Record<string, unknown>;
  timings?: Record<string, number>;
  worker?: Record<string, unknown>;
}

const SUPPORTED: readonly GenerationKind[] = ['song', 'clip', 'cover', 'remix', 'replace_section'];

/** Duração padrão de um clipe da aba Sounds quando o usuário não escolhe. */
const DEFAULT_CLIP_SECONDS = 30;

/** Faixas que o worker entrega numa chamada. Espelha `batch_size` do handler. */
const MAX_VARIANTS = 2;

/** Falhas seguidas de rede no polling antes de desistir do job. */
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export class AceStepProvider implements MusicProvider {
  readonly id = 'acestep';
  readonly displayName = 'ACE-Step 1.5 (RunPod)';
  /** Teto com o LM ligado; o LM é obrigatório para o ritmo sair certo. */
  readonly maxDurationSeconds = 480;
  readonly supportedKinds = SUPPORTED;

  private readonly baseUrl: string;
  private readonly statusMethod: 'GET' | 'POST';
  private readonly queueTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly config: AceStepConfig) {
    if (!config.baseUrl) throw new Error('AceStepProvider exige baseUrl do endpoint da RunPod.');
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.statusMethod = config.statusMethod ?? 'GET';
    // Um job fica IN_QUEUE também enquanto o worker sobe e carrega os modelos.
    // Com o XL-SFT e o LM 4B (~17 GB de pesos) isso passa dos 120 s de antes, e
    // cada cold start viraria uma queda para o Lyria — dez vezes mais caro e
    // de outra qualidade.
    this.queueTimeoutMs = config.queueTimeoutMs ?? 300_000;
    this.totalTimeoutMs = config.totalTimeoutMs ?? 15 * 60_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 2_000;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = config.now ?? Date.now;
  }

  estimateCredits(req: MusicGenerationRequest): number {
    if (req.kind === 'clip') return CREDIT_COSTS.clip;
    if (req.kind === 'replace_section') return CREDIT_COSTS.replaceSection;
    if (req.kind === 'cover' || req.kind === 'remix') return CREDIT_COSTS.remix;
    return CREDIT_COSTS.song;
  }

  async generate(req: MusicGenerationRequest): Promise<MusicGenerationResult> {
    const input = buildJobInput(req);
    const startedAt = this.now();

    const submitted = await this.call<RunPodJob>('POST', '/run', { input });
    if (!submitted?.id) {
      throw this.error('RunPod aceitou o /run mas não devolveu o id do job.', true);
    }

    let job = submitted;
    let consecutiveFailures = 0;

    while (!isTerminal(job.status)) {
      const elapsed = this.now() - startedAt;
      if (job.status === 'IN_QUEUE' && elapsed > this.queueTimeoutMs) {
        await this.cancel(job.id);
        throw this.error(
          `Sem GPU disponível na RunPod: job ${job.id} ficou ${Math.round(elapsed / 1000)}s na fila.`,
          true,
        );
      }
      if (elapsed > this.totalTimeoutMs) {
        await this.cancel(job.id);
        throw this.error(`Job ${job.id} passou do tempo máximo de ${this.totalTimeoutMs / 1000}s.`, true);
      }

      await this.sleep(this.pollIntervalMs);
      try {
        // O emulador local executa o job dentro desta chamada; dá tempo a ela.
        job = await this.call<RunPodJob>(this.statusMethod, `/status/${job.id}`, undefined, {
          timeoutMs: Math.max(this.requestTimeoutMs, this.totalTimeoutMs - elapsed),
        });
        consecutiveFailures = 0;
      } catch (err) {
        // Uma oscilação de rede no polling não pode perder um job que está rodando.
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw err;
      }
    }

    return this.toResult(job, req);
  }

  private toResult(job: RunPodJob, req: MusicGenerationRequest): MusicGenerationResult {
    if (job.status !== 'COMPLETED') {
      const message = job.error ?? (job.output as { error?: string } | undefined)?.error ?? job.status;
      // "entrada inválida" vem da validação do handler: erro nosso, repetir não adianta.
      const retryable = !String(message).startsWith('entrada inválida');
      throw this.error(`Job ${job.id} terminou como ${job.status}: ${message}`, retryable);
    }

    const output = job.output as WorkerOutput | undefined;
    const [track, ...extraTracks] = output?.tracks ?? [];
    if (!track?.storage_key) {
      throw this.error(`Job ${job.id} completou sem faixa na saída.`, true);
    }

    // O worker só pode ter gravado onde mandamos, faixa a faixa e na ordem;
    // qualquer outra chave é bug.
    const targets = [req.uploadTarget, ...(req.variantUploadTargets ?? [])];
    for (const [index, written] of [track, ...extraTracks].entries()) {
      const target = targets[index];
      if (target && written.storage_key !== target.storageKey) {
        throw this.error(
          `Worker gravou em ${written.storage_key}, mas o destino pedido era ${target.storageKey}.`,
          false,
        );
      }
    }

    const variants: GeneratedVariant[] = extraTracks.map((extra) => ({
      audio: { kind: 'stored', storageKey: extra.storage_key, sizeBytes: extra.size_bytes },
      sourceFormat: extra.format,
      durationMs: extra.duration_ms,
      seed: extra.seed,
    }));

    return {
      audio: { kind: 'stored', storageKey: track.storage_key, sizeBytes: track.size_bytes },
      sourceFormat: track.format,
      durationMs: track.duration_ms,
      ...(variants.length ? { variants } : {}),
      providerRef: job.id,
      providerMetadata: {
        ...(output?.metadata ?? {}),
        seed: track.seed,
        timings: output?.timings,
        worker: output?.worker,
      },
    };
  }

  private async cancel(jobId: string): Promise<void> {
    try {
      await this.call('POST', `/cancel/${jobId}`);
    } catch {
      // Cancelar é cortesia para não pagar GPU à toa; a falha real já vai ser lançada.
    }
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? this.requestTimeoutMs),
      });
    } catch (err) {
      throw this.error(`Falha de rede em ${method} ${path}: ${(err as Error).message}`, true, err);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw this.error(describeHttpError(response.status, path, text), isRetryableStatus(response.status));
    }
    return (await response.json()) as T;
  }

  private error(message: string, retryable: boolean, cause?: unknown): MusicProviderError {
    return new MusicProviderError(message, this.id, retryable, cause);
  }
}

/**
 * Traduz o pedido do produto para a entrada do handler do worker GPU.
 * Exportada para teste: é o contrato entre as duas pontas.
 */
export function buildJobInput(req: MusicGenerationRequest): Record<string, unknown> {
  if (!req.uploadTarget) {
    throw new MusicProviderError(
      'AceStepProvider exige uploadTarget: o worker sobe o áudio direto no R2.',
      'acestep',
      false,
    );
  }
  if ((req.kind === 'cover' || req.kind === 'remix' || req.kind === 'replace_section') && !req.sourceAudioUrl) {
    throw new MusicProviderError(`'${req.kind}' exige sourceAudioUrl.`, 'acestep', false);
  }

  // Exclusão de voz vira instrumental nativo, não "no vocals" no caption.
  const instrumental = req.instrumental || excludesVocals(req.controls.excludeStyles);
  const caption =
    compileAceStepCaption({
      styles: req.prompt,
      excludeStyles: req.controls.excludeStyles,
      instrumental: req.instrumental,
      controls: req.controls,
      soundType: req.soundType,
    }) || (instrumental ? 'instrumental music' : 'song');

  const taskType =
    req.kind === 'replace_section' ? 'repaint' : req.kind === 'cover' || req.kind === 'remix' ? 'cover' : 'text2music';

  // Variantes só existem na geração a partir do texto. Cover e repaint partem
  // do áudio de origem e o worker roda uma faixa por chamada nesses casos.
  const targets = [req.uploadTarget, ...(req.variantUploadTargets ?? [])];
  if (targets.length > MAX_VARIANTS || (targets.length > 1 && taskType !== 'text2music')) {
    throw new MusicProviderError(
      `'${req.kind}' não aceita ${targets.length} faixas por pedido ` +
        `(o limite é ${MAX_VARIANTS}, e só em música nova a partir do texto).`,
      'acestep',
      false,
    );
  }

  return {
    task_type: taskType,
    caption,
    // O que evitar vai à parte do caption: ver compileAceStepCaption.
    negative_caption: buildAceStepNegative(req.controls.excludeStyles) ?? null,
    lyrics: instrumental ? '' : (req.lyrics ?? ''),
    instrumental,
    duration: req.kind === 'clip' ? (req.durationSeconds ?? DEFAULT_CLIP_SECONDS) : (req.durationSeconds ?? null),
    bpm: req.controls.bpm ?? null,
    keyscale: toAceStepKeyscale(req.controls.key) ?? null,
    vocal_language: req.vocalLanguage ?? 'unknown',
    seed: req.seed ?? null,
    // Controles 0–100 da UI. O worker os traduz para os parâmetros do modelo
    // que estiver carregado: quem conhece o turbo e o SFT é ele.
    style_influence: req.controls.styleInfluence,
    variety: req.controls.variety,
    batch_size: targets.length,
    src_audio_url: req.sourceAudioUrl ?? null,
    repainting_start: req.sectionStartMs !== undefined ? req.sectionStartMs / 1000 : 0,
    repainting_end: req.sectionEndMs !== undefined ? req.sectionEndMs / 1000 : -1,
    uploads: targets.map((target) => ({ url: target.url, storage_key: target.storageKey })),
  };
}

function isTerminal(status: RunPodStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT';
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

function describeHttpError(status: number, path: string, body: string): string {
  if (status === 401 || status === 403) {
    return `RunPod recusou a chave (${status}) em ${path}. Confira RUNPOD_API_KEY.`;
  }
  if (status === 404) {
    return `Endpoint da RunPod não encontrado (${path}). Confira RUNPOD_ENDPOINT_ID.`;
  }
  return `RunPod respondeu ${status} em ${path}: ${body.slice(0, 300)}`;
}
