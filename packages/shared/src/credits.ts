/**
 * Tabela de custos em créditos.
 *
 * Referência: 1 crédito ~= R$ 0,01 de custo interno.
 * Lyria 3 Pro custa $0.08 por música e Lyria 3 Clip $0.04 por clipe de 30s.
 * Operações que rodam só com FFmpeg no nosso worker não consomem crédito.
 */

export const CREDIT_COSTS = {
  /** Música completa via Lyria 3 Pro (~3 min) */
  song: 10,
  /** Clipe/one-shot/loop via Lyria 3 Clip (30s) — aba Sounds */
  clip: 5,
  /** Continuar uma música existente */
  extend: 10,
  /** Regerar com novo estilo mantendo a base */
  remix: 10,
  /** Substituir um trecho específico */
  replaceSection: 10,
  /** Remasterizar */
  remaster: 10,
  /** Capa gerada por modelo de imagem */
  cover: 2,
  /** Letra escrita por LLM */
  lyrics: 1,
  /** Sugestão de estilo pelo LLM (botão de dado) */
  styleSuggestion: 0,

  // --- Gratuitas: rodam em FFmpeg/Demucs no nosso worker ---
  transcode: 0,
  crop: 0,
  fade: 0,
  adjustSpeed: 0,
  reverse: 0,
  normalize: 0,
  stems: 0,
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;

/** Operações que chamam um provedor externo e portanto podem falhar e exigir estorno. */
export const BILLABLE_OPERATIONS = (
  Object.keys(CREDIT_COSTS) as CreditOperation[]
).filter((op) => CREDIT_COSTS[op] > 0);

export function creditCostOf(operation: CreditOperation): number {
  return CREDIT_COSTS[operation];
}

/**
 * Origem dos créditos numa carteira.
 * `plan` expira na renovação da assinatura; `pack` vale 12 meses.
 * O consumo sempre drena `plan` antes de `pack`, para que o crédito comprado
 * avulso seja o último a ser perdido.
 */
export const CREDIT_BUCKETS = ['plan', 'pack'] as const;
export type CreditBucket = (typeof CREDIT_BUCKETS)[number];

export const CREDIT_REASONS = [
  'plan_renewal',
  'pack_purchase',
  'generation',
  'refund',
  'manual_grant',
  'expiration',
] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

/** Validade dos créditos comprados avulsos, em meses. */
export const PACK_VALIDITY_MONTHS = 12;

export interface CreditPack {
  readonly code: string;
  readonly credits: number;
  readonly priceBrl: number;
  readonly label: string;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { code: 'pack_500', credits: 500, priceBrl: 19.9, label: '500 créditos' },
  { code: 'pack_1500', credits: 1500, priceBrl: 49.9, label: '1.500 créditos' },
  { code: 'pack_5000', credits: 5000, priceBrl: 149.9, label: '5.000 créditos' },
];
