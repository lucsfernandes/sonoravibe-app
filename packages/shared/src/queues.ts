/**
 * Nomes de fila e formato dos jobs.
 *
 * Vive no pacote compartilhado porque a API produz e o worker consome: um nome
 * divergente faria o job sumir em silêncio, sem erro em nenhum dos dois lados.
 */

import type { AudioFormat } from './audio';
import type { GenerationKind } from './generation';
import type { StemKind } from './audio';

export const QUEUES = {
  /** Gera música: chama o motor (ACE-Step, reserva Lyria) e finaliza a faixa. */
  generation: 'generation',
  /** Converte o master para outros formatos sob demanda. */
  transcode: 'transcode',
  /** Edição sem IA: crop, fade, velocidade, reverse, normalização. */
  edit: 'edit',
  /** Separação de stems com Demucs (worker dedicado, fila própria). */
  stems: 'stems',
  /** Rotinas: backup, limpeza de cache, expiração de créditos. */
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Canal do Redis por onde o progresso chega ao SSE da API. */
export const PROGRESS_CHANNEL = 'sonora:generation-progress';

export interface GenerationJob {
  generationId: string;
  songId: string;
  userId: string;
  kind: GenerationKind;
  /** Créditos já reservados no ledger; estornados se o job falhar. */
  reservedCredits: number;
}

export interface TranscodeJob {
  songId: string;
  format: AudioFormat;
  /** Quem pediu, para notificar quando ficar pronto. */
  userId: string;
}

export interface StemsJob {
  songId: string;
  userId: string;
  kinds: readonly StemKind[];
}

/**
 * Prioridade do BullMQ: no BullMQ o número MENOR é atendido primeiro.
 * Vem de PlanFeatures.queuePriority (Premier 1, Pro 5, Free 10).
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;
