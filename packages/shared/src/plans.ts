import type { AudioFormat } from './audio';

export const PLAN_CODES = ['free', 'pro', 'premier'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanFeatures {
  /** Formatos que este plano pode baixar */
  readonly downloadFormats: readonly AudioFormat[];
  /**
   * Qualidade do MP3 servido.
   * 'full'    = 320 kbps derivado do master FLAC (ACE-Step), ou o próprio master
   *             MP3 sem reencode quando a faixa veio do Lyria (preserva o C2PA).
   * 'preview' = 128 kbps (limitação do Free).
   */
  readonly mp3Quality: 'preview' | 'full';
  /** Pode separar stems com Demucs */
  readonly stems: boolean;
  /** Direito de uso comercial do output */
  readonly commercialUse: boolean;
  /** Prioridade na fila BullMQ — no BullMQ, 1 é a MAIOR prioridade (Premier=1 fura a fila) */
  readonly queuePriority: number;
  /** Quantas gerações podem rodar ao mesmo tempo */
  readonly maxConcurrentGenerations: number;
  /** Libera Max Mode (geração mais longa/custosa) */
  readonly maxMode: boolean;
  /** Duração máxima por música, em segundos. O teto técnico é 480 s. */
  readonly maxDurationSeconds: number;
  /** Download em lote (ZIP) */
  readonly batchDownload: boolean;
}

export interface Plan {
  readonly code: PlanCode;
  readonly name: string;
  readonly priceBrl: number;
  /** Créditos concedidos por mês. No Free a concessão é diária. */
  readonly monthlyCredits: number;
  /** Só no Free: créditos renovados a cada 24h */
  readonly dailyCredits?: number;
  readonly features: PlanFeatures;
}

export const PLANS: Record<PlanCode, Plan> = {
  free: {
    code: 'free',
    name: 'Free',
    priceBrl: 0,
    monthlyCredits: 0,
    dailyCredits: 30,
    features: {
      downloadFormats: ['mp3'],
      mp3Quality: 'preview',
      stems: false,
      commercialUse: false,
      queuePriority: 10,
      maxConcurrentGenerations: 1,
      maxMode: false,
      maxDurationSeconds: 120,
      batchDownload: false,
    },
  },
  /**
   * Pro e Premier recebem TODOS os formatos; o Free, só MP3 128 kbps.
   *
   * Formato não é alavanca entre os planos pagos. O Premier se diferencia pelo
   * que é mensurável: volume de créditos, fila prioritária, mais gerações
   * simultâneas e Max Mode (músicas de até 8 min).
   */
  pro: {
    code: 'pro',
    name: 'Pro',
    priceBrl: 39,
    monthlyCredits: 5_000,
    features: {
      downloadFormats: ['mp3', 'wav', 'flac', 'm4a', 'opus'],
      mp3Quality: 'full',
      stems: true,
      commercialUse: true,
      queuePriority: 5,
      maxConcurrentGenerations: 3,
      maxMode: false,
      maxDurationSeconds: 240,
      batchDownload: true,
    },
  },
  premier: {
    code: 'premier',
    name: 'Premier',
    priceBrl: 99,
    monthlyCredits: 20_000,
    features: {
      downloadFormats: ['mp3', 'wav', 'flac', 'm4a', 'opus'],
      mp3Quality: 'full',
      stems: true,
      commercialUse: true,
      queuePriority: 1,
      maxConcurrentGenerations: 6,
      maxMode: true,
      maxDurationSeconds: 480,
      batchDownload: true,
    },
  },
};

/**
 * Teto de duração que os motores ligados hoje realmente entregam.
 *
 * O Lyria não recebe duração como parâmetro — ela viaja como sugestão de texto
 * dentro do prompt — e devolve no máximo ~3 min. O ACE-Step chega aos 480 s dos
 * planos, mas roda na RunPod, que ainda não está de pé.
 *
 * Enquanto for assim, anunciar "4 min" no Pro e "8 min" no Premier é cobrar por
 * algo que não sai: numa geração de teste em produção, um usuário Free pediu
 * uma música e recebeu 3:01, acima até do limite do próprio plano.
 *
 * Quando a RunPod existir, este teto vira 480 e os limites por plano voltam a
 * valer sozinhos — nenhum outro lugar precisa mudar.
 */
export const ENGINE_MAX_DURATION_SECONDS = 180;

/**
 * Duração máxima real de uma música neste plano, hoje.
 *
 * Existe para que a tela de planos, a validação da API e a fila leiam o mesmo
 * número. Ler `features.maxDurationSeconds` direto é o que produz a promessa
 * que o motor não cumpre.
 */
export function maxDurationFor(code: PlanCode): number {
  return Math.min(PLANS[code].features.maxDurationSeconds, ENGINE_MAX_DURATION_SECONDS);
}

export function planOf(code: PlanCode): Plan {
  return PLANS[code];
}

export function canDownloadFormat(code: PlanCode, format: AudioFormat): boolean {
  return PLANS[code].features.downloadFormats.includes(format);
}
