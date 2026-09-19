import { z } from 'zod';

/**
 * Contrato de geração.
 *
 * Espelha os controles das três abas do Create (Simple, Advanced, Sounds).
 * O ACE-Step (motor principal) recebe duração, BPM, tom e idioma como parâmetros
 * nativos. O Lyria (reserva) não tem esses parâmetros: no caminho de reserva,
 * tudo é traduzido para linguagem natural pelo Prompt Compiler —
 * ver apps/worker/src/generation/prompt-compiler.ts.
 */

export const GENERATION_MODES = ['simple', 'advanced', 'sounds'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const VOCAL_GENDERS = ['any', 'male', 'female'] as const;
export type VocalGender = (typeof VOCAL_GENDERS)[number];

export const SOUND_TYPES = ['one-shot', 'loop'] as const;
export type SoundType = (typeof SOUND_TYPES)[number];

export const MUSICAL_KEYS = [
  'any',
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm',
] as const;
export type MusicalKey = (typeof MUSICAL_KEYS)[number];

/**
 * Limites de duração, em segundos.
 * O teto é 480 s (8 min): o ACE-Step limita a isso com o LM ligado, e o LM
 * (`thinking`) é obrigatório — sem ele os instrumentos saem descompassados.
 * O limite de cada usuário vem do plano (PlanFeatures.maxDurationSeconds).
 */
export const MIN_DURATION_SECONDS = 10;
export const MAX_DURATION_SECONDS = 480;

const percent = z.number().int().min(0).max(100);

/** Controles avançados — todos opcionais, com defaults equivalentes ao Suno. */
export const advancedControlsSchema = z.object({
  /** Estilos desejados, em texto livre ou tags. Vira a base do prompt. */
  styles: z.string().trim().max(1000).optional(),
  /** Estilos/elementos a evitar. Vira instrução negativa no prompt. */
  excludeStyles: z.string().trim().max(1000).optional(),
  vocalGender: z.enum(VOCAL_GENDERS).default('any'),
  /**
   * Duração desejada. Ausente = automática: o modelo decide pelo tamanho da
   * letra — o recomendado para música cantada. Forçar estica ou comprime a
   * estrutura (medido: a letra de teste pedia 210 s e forçamos 270 s).
   */
  durationSeconds: z
    .number()
    .int()
    .min(MIN_DURATION_SECONDS)
    .max(MAX_DURATION_SECONDS)
    .optional(),
  /** Libera músicas de até 8 min. Exclusivo do plano Premier. */
  maxMode: z.boolean().default(false),
  /** 0 = previsível, 100 = experimental */
  weirdness: percent.default(50),
  /** Quanto o modelo deve aderir ao estilo descrito */
  styleInfluence: percent.default(50),
  /** Variedade entre as duas faixas geradas no mesmo pedido */
  variety: z.enum(['low', 'medium', 'high']).default('high'),
  /** Usa o histórico de likes do usuário para enviesar o prompt */
  personalize: z.boolean().default(false),
  bpm: z.number().int().min(40).max(220).optional(),
  key: z.enum(MUSICAL_KEYS).default('any'),
});
export type AdvancedControls = z.infer<typeof advancedControlsSchema>;

/** Aba Simple: só a descrição em linguagem natural. */
export const simpleGenerationSchema = z.object({
  mode: z.literal('simple'),
  prompt: z.string().trim().min(3).max(2000),
  instrumental: z.boolean().default(false),
  workspaceId: z.string().uuid().optional(),
});

/** Aba Advanced: letra própria ou gerada, estilos e controles finos. */
export const advancedGenerationSchema = z.object({
  mode: z.literal('advanced'),
  /**
   * Letra fornecida pelo usuário. Quando ausente e `instrumental` é false,
   * o worker pede ao LLM que escreva a letra a partir de `lyricsBrief`.
   */
  lyrics: z.string().trim().max(6000).optional(),
  /** Tema para o LLM escrever a letra, quando `lyrics` não foi informada. */
  lyricsBrief: z.string().trim().max(1000).optional(),
  instrumental: z.boolean().default(false),
  title: z.string().trim().max(120).optional(),
  workspaceId: z.string().uuid().optional(),
  controls: advancedControlsSchema.default({}),
});

/** Aba Sounds: efeitos, loops e one-shots curtos. */
export const soundsGenerationSchema = z.object({
  mode: z.literal('sounds'),
  prompt: z.string().trim().min(3).max(1000),
  soundType: z.enum(SOUND_TYPES).default('one-shot'),
  /** `undefined` = automático */
  bpm: z.number().int().min(40).max(220).optional(),
  key: z.enum(MUSICAL_KEYS).default('any'),
  workspaceId: z.string().uuid().optional(),
});

export const generationRequestSchema = z.discriminatedUnion('mode', [
  simpleGenerationSchema,
  advancedGenerationSchema,
  soundsGenerationSchema,
]);
export type GenerationRequest = z.infer<typeof generationRequestSchema>;

/** Operações derivadas de uma música existente. */
export const GENERATION_KINDS = [
  'song',
  'clip',
  'extend',
  'remix',
  'cover',
  'replace_section',
  'remaster',
] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const GENERATION_STATUSES = [
  'queued',
  'compiling_prompt',
  'writing_lyrics',
  'generating_audio',
  'uploading',
  'generating_cover',
  'complete',
  'failed',
  'canceled',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** Status que indicam que o job terminou e não vai mais mudar. */
export const TERMINAL_STATUSES: readonly GenerationStatus[] = [
  'complete',
  'failed',
  'canceled',
];

export function isTerminal(status: GenerationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Rótulos exibidos ao usuário enquanto a música é gerada. */
export const STATUS_LABELS: Record<GenerationStatus, { pt: string; en: string }> = {
  queued: { pt: 'Na fila', en: 'Queued' },
  compiling_prompt: { pt: 'Interpretando o estilo', en: 'Interpreting style' },
  writing_lyrics: { pt: 'Escrevendo a letra', en: 'Writing lyrics' },
  generating_audio: { pt: 'Compondo a música', en: 'Composing' },
  uploading: { pt: 'Finalizando o áudio', en: 'Finalizing audio' },
  generating_cover: { pt: 'Criando a capa', en: 'Creating cover art' },
  complete: { pt: 'Pronta', en: 'Ready' },
  failed: { pt: 'Falhou', en: 'Failed' },
  canceled: { pt: 'Cancelada', en: 'Canceled' },
};

/** Evento enviado por SSE enquanto a geração progride. */
export interface GenerationProgressEvent {
  generationId: string;
  songId: string;
  status: GenerationStatus;
  /** 0–100, estimado a partir do status */
  progress: number;
  /** Preenchido quando status === 'complete' */
  song?: {
    id: string;
    title: string;
    durationMs: number;
    audioUrl: string;
    coverUrl: string | null;
  };
  /** Preenchido quando status === 'failed' */
  error?: string;
}

/** Progresso aproximado por status, para a barra da UI. */
export const STATUS_PROGRESS: Record<GenerationStatus, number> = {
  queued: 5,
  compiling_prompt: 15,
  writing_lyrics: 25,
  generating_audio: 60,
  uploading: 80,
  generating_cover: 92,
  complete: 100,
  failed: 100,
  canceled: 100,
};
