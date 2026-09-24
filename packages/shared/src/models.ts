/**
 * Versões do motor de música que o usuário escolhe na aba Criar.
 *
 * Cada versão é uma receita do ACE-Step escolhida por ESCUTA, não por métrica:
 * nos benchmarks (docs/BENCHMARK-QUALIDADE.md e docs/BENCHMARK-MIDNIGHT.md) as
 * métricas apontaram o vencedor errado duas vezes. Trocar passos, modelo ou a
 * reescrita do caption de uma versão exige gerar faixas e ouvir de novo.
 *
 * As versões se dividem em duas FAMÍLIAS de modelo, e cada família roda num
 * endpoint próprio da RunPod: um worker carrega um único DiT na memória, e o
 * XL-turbo e o XL-SFT juntos não cabem numa GPU de 24 GB. Dentro da família, o
 * que muda de uma versão para outra (passos e reescrita do caption) vai no
 * próprio pedido.
 */

export const MUSIC_MODELS = ['v1', 'v1.5', 'v2.0', 'v2.5'] as const;
export type MusicModel = (typeof MUSIC_MODELS)[number];

/** A versão de quem não escolhe nada: a mais barata, aprovada na escuta de 2026-09-23. */
export const DEFAULT_MUSIC_MODEL: MusicModel = 'v1';

/** Família = qual DiT, e portanto qual endpoint da RunPod. */
export type ModelFamily = 'turbo' | 'sft';

export interface MusicModelSpec {
  readonly id: MusicModel;
  readonly family: ModelFamily;
  /** Checkpoint do ACE-Step que o endpoint da família carrega. */
  readonly checkpoint: string;
  /** Passos de difusão. No turbo é sempre 8: ele é destilado para isso. */
  readonly steps: number;
  /**
   * O LM reescreve o caption antes do modelo de áudio ler. No XL-SFT, desligar
   * foi o que fez a música soar coerente (S50N); no turbo, a versão com
   * reescrita é a que foi aprovada primeiro (FO360).
   */
  readonly cotCaption: boolean;
  readonly label: { readonly pt: string; readonly en: string };
  readonly description: { readonly pt: string; readonly en: string };
}

export const MUSIC_MODEL_SPECS: Record<MusicModel, MusicModelSpec> = {
  v1: {
    id: 'v1',
    family: 'turbo',
    checkpoint: 'acestep-v15-xl-turbo',
    steps: 8,
    cotCaption: true,
    label: { pt: 'v1', en: 'v1' },
    description: {
      pt: 'Rápida e econômica. Interpreta o seu estilo com liberdade.',
      en: 'Fast and affordable. Interprets your style freely.',
    },
  },
  'v1.5': {
    id: 'v1.5',
    family: 'turbo',
    checkpoint: 'acestep-v15-xl-turbo',
    steps: 8,
    cotCaption: false,
    label: { pt: 'v1.5', en: 'v1.5' },
    description: {
      pt: 'Rápida e econômica. Segue o seu texto ao pé da letra.',
      en: 'Fast and affordable. Follows your text literally.',
    },
  },
  'v2.0': {
    id: 'v2.0',
    family: 'sft',
    checkpoint: 'acestep-v15-xl-sft',
    steps: 32,
    cotCaption: false,
    label: { pt: 'v2.0', en: 'v2.0' },
    description: {
      pt: 'Mais detalhada e fiel ao estilo. Leva mais tempo.',
      en: 'More detailed and true to style. Takes longer.',
    },
  },
  'v2.5': {
    id: 'v2.5',
    family: 'sft',
    checkpoint: 'acestep-v15-xl-sft',
    steps: 50,
    cotCaption: false,
    label: { pt: 'v2.5', en: 'v2.5' },
    description: {
      pt: 'A melhor construção e harmonia. A mais lenta.',
      en: 'Best structure and harmony. The slowest.',
    },
  },
};

export function isMusicModel(value: unknown): value is MusicModel {
  return typeof value === 'string' && (MUSIC_MODELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Preço em créditos
// ---------------------------------------------------------------------------

/**
 * Faixas de duração da cobrança, em segundos: até 2, 4 e 6 min.
 *
 * O custo de GPU cresce em linha com a duração (medido: 6 min custam ~3× 2 min),
 * então preço fixo por música deixaria a de 6 min no prejuízo ou a de 2 min cara.
 */
export const DURATION_BANDS = [120, 240, 360] as const;

/**
 * Créditos de um pedido de música nova (duas faixas), por versão e faixa de
 * duração — [até 2 min, até 4 min, até 6 min].
 *
 * Como os números saíram (docs/PRECOS.md): custo de GPU medido na L4 por pedido
 * de duas faixas, +30% de folga (cold start, tempo ocioso, capa, letra), e o
 * preço fixado para que esse custo fique em no máximo ~30% da receita no
 * crédito mais barato vendido (Premier, ~R$ 0,02 por crédito).
 *
 *   custo/pedido (US$)   2 min    4 min    6 min
 *   v1 / v1.5            0,009    0,018    0,028
 *   v2.0                 0,021    0,042    0,062
 *   v2.5                 0,027    0,055    0,082
 *
 * (v2.5 subiu de 25 para 26: a 25, a GPU ficava em 30,7% da receita no Premier.
 * O teste apps/worker/test/precos.test.ts segura esse teto.)
 *
 * v1 até 2 min custa 10, o mesmo preço de antes para a música de sempre.
 */
export const MODEL_CREDITS: Record<MusicModel, readonly [number, number, number]> = {
  v1: [10, 20, 30],
  'v1.5': [10, 20, 30],
  'v2.0': [20, 40, 60],
  'v2.5': [26, 52, 78],
};

/**
 * Duração que a cobrança assume quando o usuário deixa a duração no automático.
 *
 * No automático o modelo decide pelo tamanho da letra, e uma música cantada
 * costuma ficar entre 3 e 4 min. Cobrar a faixa de 4 min é o que não deixa a
 * música comum no prejuízo sem cobrar 6 min de quem não pediu 6.
 */
export const AUTO_DURATION_BILLED_AS = 240;

/**
 * A duração que o pedido vai usar e pela qual é cobrado.
 *
 * Escolhida pelo usuário: é ela. No automático: "até 4 min", a não ser que o
 * plano não chegue lá — o Free para em 2 min, e cobrar 4 min dele custaria o
 * dobro por uma música que ele não pode ter. Nesse caso a música é gerada com o
 * teto do plano e cobrada por ele.
 *
 * Devolve `undefined` quando a duração continua automática (o modelo decide).
 */
export function effectiveDuration(
  requestedSeconds: number | null | undefined,
  planMaxSeconds: number,
): number | undefined {
  if (requestedSeconds) return requestedSeconds;
  return planMaxSeconds < AUTO_DURATION_BILLED_AS ? planMaxSeconds : undefined;
}

/** Índice da faixa de duração (0, 1 ou 2) de uma duração em segundos. */
export function durationBandOf(durationSeconds?: number | null): 0 | 1 | 2 {
  const seconds = durationSeconds ?? AUTO_DURATION_BILLED_AS;
  if (seconds <= DURATION_BANDS[0]) return 0;
  if (seconds <= DURATION_BANDS[1]) return 1;
  return 2;
}

/** Créditos de um pedido de música nova nesta versão e duração. */
export function songCreditCost(model: MusicModel, durationSeconds?: number | null): number {
  return MODEL_CREDITS[model][durationBandOf(durationSeconds)];
}
