import type { AdvancedControls, GenerationKind, SoundType } from './generation';

/**
 * Contrato que todo motor de geração musical precisa cumprir.
 *
 * Implementações:
 *  - AceStepProvider — ACE-Step 1.5 na RunPod Serverless (principal)
 *  - LyriaProvider   — Google Lyria 3 via OpenRouter (reserva automática)
 *  - MockProvider    — áudio sintético via FFmpeg (desenvolvimento, custo zero)
 *
 * Trocar ou somar motor é implementar esta interface e registrar no roteador
 * de providers, que escolhe o principal e cai na reserva em falha ou timeout.
 */

export interface MusicGenerationRequest {
  kind: GenerationKind;
  /**
   * Estilo ou descrição como o usuário escreveu, SEM compilação prévia.
   * Cada provider traduz os controles do seu jeito: o ACE-Step recebe BPM,
   * tom, duração e idioma como parâmetros nativos; o Lyria não tem esses
   * parâmetros e passa tudo pelo Prompt Compiler.
   */
  prompt: string;
  /** Letra final. `null` quando instrumental. */
  lyrics: string | null;
  instrumental: boolean;
  /** Ausente = o provider decide (ACE-Step: pelo tamanho da letra; Lyria: ~3 min). */
  durationSeconds?: number;
  controls: AdvancedControls;
  /** Aba Sounds: one-shot ou loop. */
  soundType?: SoundType;
  /** Idioma dos vocais ('pt', 'en'...). Ausente = o modelo detecta pela letra. */
  vocalLanguage?: string;
  /**
   * Seed para reprodução. Só garante o mesmo áudio no mesmo tipo de GPU —
   * medido: a mesma seed gerou áudios diferentes em GPU e CPU.
   */
  seed?: number;
  /** Para extend/remix/replace_section: áudio de origem. */
  sourceAudioUrl?: string;
  /** Janela a substituir, em ms, quando kind === 'replace_section'. */
  sectionStartMs?: number;
  sectionEndMs?: number;
  /**
   * Destino pré-assinado no R2. Providers que rodam fora do cluster (ACE-Step
   * na RunPod) sobem o áudio direto aqui: a resposta da RunPod é limitada a
   * 10–30 MB e um master FLAC de 4 min passa disso.
   */
  uploadTarget?: UploadTarget;
  /**
   * Destinos das variantes além da principal: cada destino é uma faixa extra
   * que o pedido quer. As variantes saem da MESMA chamada ao motor (mesmo
   * prompt, seeds diferentes), e é isso que as torna baratas — uma segunda
   * chamada pagaria de novo a carga do worker e a fila.
   *
   * Um motor que só entrega uma faixa (o Lyria) ignora este campo e devolve
   * `variants` vazio; quem pediu confere o que voltou.
   */
  variantUploadTargets?: UploadTarget[];
}

export interface UploadTarget {
  url: string;
  storageKey: string;
  contentType: string;
}

/** O áudio volta em memória (Lyria, Mock) ou já gravado no R2 (ACE-Step). */
export type GeneratedAudio =
  | { kind: 'buffer'; data: Buffer }
  | { kind: 'stored'; storageKey: string; sizeBytes: number };

/** Uma faixa a mais do mesmo pedido, na ordem de `variantUploadTargets`. */
export interface GeneratedVariant {
  audio: GeneratedAudio;
  sourceFormat: string;
  durationMs: number;
  /** Seed desta faixa, para reproduzir ou regerar só ela. */
  seed?: number;
}

export interface MusicGenerationResult {
  audio: GeneratedAudio;
  /** Extensão do áudio devolvido (ex.: 'wav', 'mp3'). */
  sourceFormat: string;
  durationMs: number;
  /**
   * Variantes além da principal. Ausente ou mais curta que `variantUploadTargets`
   * quando o motor não conseguiu entregar todas.
   */
  variants?: GeneratedVariant[];
  /** Identificador do lado do provedor, para rastreio e suporte. */
  providerRef?: string;
  /** Título sugerido pelo provedor, quando houver. */
  suggestedTitle?: string;
  /**
   * O que o provedor decidiu sozinho: BPM, tom, idioma detectado, seed usada,
   * tempos de execução. Alimenta a tela "Song Details" e o diagnóstico de custo.
   */
  providerMetadata?: Record<string, unknown>;
}

export interface MusicProvider {
  /** Identificador estável usado no banco e nos logs. */
  readonly id: string;
  readonly displayName: string;
  /** Duração máxima que este provedor entrega, em segundos. */
  readonly maxDurationSeconds: number;
  /** Operações que este provedor suporta. */
  readonly supportedKinds: readonly GenerationKind[];

  generate(req: MusicGenerationRequest): Promise<MusicGenerationResult>;

  /** Custo em créditos, para checagem de saldo antes de enfileirar. */
  estimateCredits(req: MusicGenerationRequest): number;
}

export class MusicProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    /** true quando faz sentido tentar de novo (rate limit, 5xx, timeout). */
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MusicProviderError';
  }
}
