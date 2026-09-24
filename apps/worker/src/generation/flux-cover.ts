import type { CoverArtResult, CoverVisual } from './cover-art';

/**
 * Capa desenhada pelo FLUX.2 [klein] 4B no nosso endpoint da RunPod
 * (apps/image-worker), com o OpenRouter como reserva.
 *
 * A capa é opcional: a música existe e toca sem ela. Por isso nada aqui lança
 * para o processador — falha vira `null` (ou a reserva) e o card cai no
 * gradiente com a inicial do título.
 */

/** O que o processador precisa de quem desenha capas. */
export interface CoverArtSource {
  readonly available: boolean;
  /**
   * `prompt`: o pedido completo (título, estilo, letra), para modelos que não
   * escrevem o que leem. `visual`: estilo e letra separados, sem o título, para
   * os que escrevem (o FLUX). Capa pedida pelo usuário com texto próprio vem sem
   * `visual`.
   */
  generate(prompt: string, visual?: CoverVisual): Promise<CoverArtResult | null>;
}

/**
 * Transforma o trecho da letra numa cena descrita em inglês. `null` quando não
 * dá: a capa sai só com o estilo, que também não gera texto na imagem.
 */
export type SceneWriter = (lyrics: string, style: string | null) => Promise<string | null>;

export interface FluxCoverConfig {
  /** https://api.runpod.ai/v2/<endpointId>, ou o emulador local do SDK da RunPod. */
  baseUrl?: string;
  apiKey?: string;
  /** A RunPod usa GET em /status; o emulador local do SDK usa POST. */
  statusMethod?: 'GET' | 'POST';
  /**
   * Tempo máximo por capa, cold start incluído. Passou disso, a reserva desenha:
   * a capa corre em paralelo à música, e uma v1 de 2 min fica pronta em ~40 s.
   * Medido na L4: 11 s de carga e 4,2 s por capa.
   */
  timeoutMs?: number;
  pollIntervalMs?: number;
  sceneWriter?: SceneWriter;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * O abre-alas medido na validação (docs/benchmarks/capas, rodada 2): com ele e
 * sem o título no pedido, o klein não escreveu nada na capa.
 */
const SEM_TEXTO =
  'Square album cover artwork. Pure illustration or photograph, with absolutely no words, ' +
  'letters, titles or typography anywhere in the image.';

/**
 * O pedido que o FLUX recebe. Com `visual`: cena (quando houver) e estilo, sem
 * título. Sem `visual` (capa pedida com texto do usuário): o texto como veio.
 */
export function fluxCoverPrompt(prompt: string, visual?: CoverVisual, scene?: string | null): string {
  if (!visual) return `${SEM_TEXTO} ${prompt}`;
  const partes = [SEM_TEXTO];
  if (scene) partes.push(`Scene: ${scene.replace(/[.\s]+$/, '')}.`);
  if (visual.style) partes.push(`Music genre and mood: ${visual.style.replace(/[.\s]+$/, '')}.`);
  return partes.join(' ');
}

export class FluxCoverGenerator implements CoverArtSource {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly config: FluxCoverConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = config.now ?? Date.now;
  }

  get available(): boolean {
    return Boolean(this.config.baseUrl);
  }

  async generate(prompt: string, visual?: CoverVisual): Promise<CoverArtResult | null> {
    if (!this.config.baseUrl) return null;
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const timeoutMs = this.config.timeoutMs ?? 150_000;
    const started = this.now();

    const scene = await this.sceneFor(visual);
    const submitted = await this.call<RunPodJob>(`${base}/run`, 'POST', {
      input: { prompt: fluxCoverPrompt(prompt, visual, scene), width: 1024, height: 1024 },
    });
    let job = submitted;

    while (!['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(job.status)) {
      if (this.now() - started > timeoutMs) {
        await this.call(`${base}/cancel/${job.id}`, 'POST').catch(() => undefined);
        throw new Error(`capa passou de ${timeoutMs / 1000}s (job ${job.id})`);
      }
      await this.sleep(this.config.pollIntervalMs ?? 1_500);
      job = await this.call<RunPodJob>(`${base}/status/${job.id}`, this.config.statusMethod ?? 'GET');
    }

    const output = job.output;
    if (job.status !== 'COMPLETED' || !output?.image_base64) {
      throw new Error(`capa terminou como ${job.status}: ${job.error ?? output?.error ?? 'sem imagem'}`);
    }
    return { mimeType: output.mime_type ?? 'image/jpeg', data: Buffer.from(output.image_base64, 'base64') };
  }

  /** Cena da letra, ou `null` (sem letra, sem escritor, ou o escritor falhou). */
  private async sceneFor(visual?: CoverVisual): Promise<string | null> {
    if (!visual?.lyrics || !this.config.sceneWriter) return null;
    try {
      return await this.config.sceneWriter(visual.lyrics, visual.style);
    } catch {
      return null; // a capa sai com o estilo, que também não gera texto
    }
  }

  private async call<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`RunPod respondeu ${response.status} na capa: ${(await response.text()).slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }
}

interface RunPodJob {
  id: string;
  status: string;
  error?: string;
  output?: { image_base64?: string; mime_type?: string; error?: string };
}

/**
 * Escritor de cena pelo modelo de texto do OpenRouter (o mesmo das letras).
 * Uma frase em inglês, só elementos visuais concretos, sem nomes nem citações:
 * é o que impede o modelo de imagem de desenhar palavras.
 */
export function openRouterSceneWriter(config: {
  apiKey?: string;
  baseUrl: string;
  model: string;
  siteUrl: string;
  appName: string;
  fetchImpl?: typeof fetch;
}): SceneWriter | undefined {
  if (!config.apiKey) return undefined;
  const fetchImpl = config.fetchImpl ?? fetch;
  return async (lyrics, style) => {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'HTTP-Referer': config.siteUrl,
        'X-Title': config.appName,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content:
              'You describe album cover scenes. Reply with ONE English sentence of at most 30 words ' +
              'listing only concrete visual elements (places, objects, light, time of day). Never quote ' +
              'the lyrics, never include names, titles or any words meant to be written in the image.',
          },
          { role: 'user', content: `Song style: ${style ?? 'unknown'}\nLyrics excerpt: ${lyrics}` },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const scene = json.choices?.[0]?.message?.content?.replace(/["“”]/g, '').trim();
    return scene ? scene.slice(0, 300) : null;
  };
}

/**
 * Tenta cada fonte na ordem e devolve a primeira capa que sair.
 *
 * Uma fonte que lança ou devolve `null` passa a vez para a próxima; só a última
 * pode deixar a música sem capa.
 */
export class CoverArtChain implements CoverArtSource {
  constructor(
    private readonly sources: readonly { name: string; source: CoverArtSource }[],
    private readonly log: (msg: string) => void = () => {},
  ) {}

  get available(): boolean {
    return this.sources.some((s) => s.source.available);
  }

  async generate(prompt: string, visual?: CoverVisual): Promise<CoverArtResult | null> {
    let lastError: unknown = null;
    for (const [index, { name, source }] of this.sources.entries()) {
      if (!source.available) continue;
      try {
        const result = await source.generate(prompt, visual);
        if (result) return result;
        this.log(`Capa: ${name} não devolveu imagem.`);
      } catch (err) {
        lastError = err;
        const next = this.sources.slice(index + 1).find((s) => s.source.available);
        this.log(`Capa: ${name} falhou (${(err as Error).message})${next ? `; tentando ${next.name}` : ''}.`);
      }
    }
    if (lastError) throw lastError;
    return null;
  }
}
