import {
  CREDIT_COSTS,
  MusicProviderError,
  type GenerationKind,
  type MusicGenerationRequest,
  type MusicGenerationResult,
  type MusicProvider,
  type KieModelControls,
} from '@sonora/shared';

interface KieConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  taskModel?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

type KieResponse<T> = {
  code: number;
  msg?: string;
  data?: T | null;
};

type KieTask = {
  taskId: string;
  state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
  resultJson?: string | null;
  failCode?: string | null;
  failMsg?: string | null;
  creditsConsumed?: number;
  response?: { data?: KieTrack[] };
};

type KieTrack = { audio_url?: string; duration?: number; title?: string };
type KieResult = { resultUrls?: string[]; response?: { data?: KieTrack[] } };

const SUPPORTED: readonly GenerationKind[] = ['song'];
const TERMINAL_STATES = new Set<KieTask['state']>(['success', 'fail']);

export class KieProvider implements MusicProvider {
  readonly id: string;
  readonly displayName: string;
  readonly maxDurationSeconds = 360;
  readonly supportedKinds = SUPPORTED;

  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly config: KieConfig) {
    if (!config.apiKey) throw new Error('KieProvider exige KIE_API_KEY.');
    this.id = `kie-${config.model.toLowerCase().replaceAll('.', '-')}`;
    this.displayName = `KIE AI ${config.model}`;
    this.timeoutMs = config.timeoutMs ?? 15 * 60 * 1000;
    this.pollIntervalMs = config.pollIntervalMs ?? 2500;
  }

  estimateCredits(req: MusicGenerationRequest): number {
    return req.kind === 'song' ? CREDIT_COSTS.song : CREDIT_COSTS.clip;
  }

  async generate(req: MusicGenerationRequest): Promise<MusicGenerationResult> {
    const created = await this.createTask(req);
    const task = await this.waitForTask(created.taskId);
    const tracks = parseResultTracks(task);
    if (tracks.length === 0) {
      throw new MusicProviderError(
        `KIE concluiu ${created.taskId}, mas não devolveu áudio.`,
        this.id,
        false,
      );
    }

    const audios = await Promise.all(tracks.map((track) => this.download(track.url)));
    const [first, ...rest] = audios;
    return {
      audio: { kind: 'buffer', data: first.data },
      sourceFormat: first.format,
      durationMs: tracks[0].durationMs,
      providerRef: created.taskId,
      variants: rest.map((audio) => ({
        audio: { kind: 'buffer', data: audio.data },
        sourceFormat: audio.format,
        durationMs: tracks[rest.indexOf(audio) + 1]?.durationMs ?? 0,
      })),
      providerMetadata: {
        taskId: created.taskId,
        model: this.config.model,
        creditsConsumed: task.creditsConsumed,
        resultUrls: tracks.map((track) => track.url),
      },
    };
  }

  private async createTask(req: MusicGenerationRequest): Promise<{ taskId: string }> {
    const controls = req.controls as KieModelControls;
    const customMode = controls.customMode;
    const input = {
      custom_mode: customMode,
      instrumental: req.instrumental,
      model: this.config.model,
      prompt: customMode ? req.lyrics?.trim() || req.prompt : req.prompt,
      lyrics: req.lyrics?.trim() || undefined,
      style: controls.styles || (!customMode ? req.prompt : undefined),
      title: customMode ? req.title?.slice(0, 80) : undefined,
      negative_tags: controls.excludeStyles || undefined,
      vocal_gender: customMode ? toKieVocalGender(controls.vocalGender) : undefined,
      style_weight: customMode ? controls.styleWeight : undefined,
      weirdness_constraint: customMode ? controls.weirdness : undefined,
      audio_weight: customMode && !req.instrumental ? controls.audioWeight : undefined,
      variety: customMode ? controls.variety : undefined,
      persona_id: customMode ? controls.personaId : undefined,
      persona_model: customMode ? controls.personaModel : undefined,
      image_urls: !customMode ? controls.imageUrls : undefined,
      video_urls: !customMode ? controls.videoUrls : undefined,
      audio_urls: !customMode ? controls.audioUrls : undefined,
      duration: customMode ? controls.durationSeconds : undefined,
    };
    const response = await this.request<KieResponse<{ taskId: string }>>('/api/v1/jobs/createTask', {
      method: 'POST',
      body: JSON.stringify({
        model: this.config.taskModel ?? 'ai-music-api/generate',
        input: withoutUndefined(input),
      }),
    });
    if (response.code !== 200 || !response.data?.taskId) {
      throw this.apiError('criar tarefa', response.code, response.msg);
    }
    return response.data;
  }

  private async waitForTask(taskId: string): Promise<KieTask> {
    const startedAt = Date.now();
    let delay = this.pollIntervalMs;
    for (;;) {
      const response = await this.request<KieResponse<KieTask>>(
        `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        { method: 'GET' },
      );
      if (response.code !== 200 || !response.data) {
        throw this.apiError('consultar tarefa', response.code, response.msg);
      }
      const task = response.data;
      if (TERMINAL_STATES.has(task.state)) {
        if (task.state === 'fail') {
          throw new MusicProviderError(
            `KIE falhou na tarefa ${taskId}: ${task.failMsg ?? 'erro desconhecido'}`,
            this.id,
            isRetryableCode(task.failCode),
          );
        }
        return task;
      }
      if (Date.now() - startedAt >= this.timeoutMs) {
        throw new MusicProviderError(
          `Tempo esgotado aguardando a tarefa KIE ${taskId}.`,
          this.id,
          true,
        );
      }
      await wait(delay);
      delay = Math.min(Math.round(delay * 1.25), 15000);
    }
  }

  private async download(url: string): Promise<{ data: Buffer; format: string }> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new MusicProviderError(`Falha ao baixar resultado KIE: ${url}`, this.id, true, err);
    }
    if (!response.ok) {
      throw new MusicProviderError(
        `KIE devolveu ${response.status} ao baixar o resultado.`,
        this.id,
        response.status >= 500 || response.status === 429,
      );
    }
    const data = Buffer.from(await response.arrayBuffer());
    const format = detectAudioFormat(data);
    if (!format) {
      throw new MusicProviderError('Resultado KIE não tem formato de áudio reconhecido.', this.id, false);
    }
    return { data, format };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });
      const body = (await response.json()) as T;
      if (!response.ok && (body as { code?: number }).code === undefined) {
        throw this.apiError('chamada HTTP', response.status, response.statusText);
      }
      return body;
    } catch (err) {
      if (err instanceof MusicProviderError) throw err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new MusicProviderError(
        aborted ? 'Tempo esgotado ao chamar a KIE AI.' : 'Falha de rede ao chamar a KIE AI.',
        this.id,
        true,
        err,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private apiError(operation: string, code: number, message?: string): MusicProviderError {
    return new MusicProviderError(
      `KIE não conseguiu ${operation} (${code}): ${message ?? 'sem mensagem'}`,
      this.id,
      isRetryableCode(String(code)),
    );
  }
}

function parseResultTracks(task: KieTask): { url: string; durationMs: number }[] {
  const tracks = task.response?.data ?? [];
  if (tracks.length > 0) {
    return tracks
      .filter((track): track is KieTrack & { audio_url: string } => typeof track.audio_url === 'string')
      .map((track) => ({ url: track.audio_url, durationMs: Math.round((track.duration ?? 0) * 1000) }));
  }
  if (!task.resultJson) return [];
  try {
    const parsed = JSON.parse(task.resultJson) as KieResult;
    if (parsed.response?.data) {
      return parsed.response.data
        .filter((track): track is KieTrack & { audio_url: string } => typeof track.audio_url === 'string')
        .map((track) => ({ url: track.audio_url, durationMs: Math.round((track.duration ?? 0) * 1000) }));
    }
    return Array.isArray(parsed.resultUrls)
      ? parsed.resultUrls.filter((url): url is string => typeof url === 'string').map((url) => ({ url, durationMs: 0 }))
      : [];
  } catch {
    return [];
  }
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function isRetryableCode(code?: string | null): boolean {
  return code === '408' || code === '429' || code === '455' || code === '500' || code === '501';
}

function toKieVocalGender(value: KieModelControls['vocalGender']): 'm' | 'f' | undefined {
  if (value === 'male') return 'm';
  if (value === 'female') return 'f';
  return undefined;
}

function detectAudioFormat(data: Buffer): string | null {
  if (data.subarray(0, 3).toString() === 'ID3' || data.subarray(0, 2).equals(Buffer.from([0xff, 0xfb]))) return 'mp3';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WAVE') return 'wav';
  if (data.subarray(0, 4).toString() === 'fLaC') return 'flac';
  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
