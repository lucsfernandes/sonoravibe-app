/**
 * Nomes de fila e formato dos jobs.
 *
 * Vive no pacote compartilhado porque a API produz e o worker consome: um nome
 * divergente faria o job sumir em silêncio, sem erro em nenhum dos dois lados.
 */

import type { AudioFormat } from './audio';
import type { GenerationKind, GenerationProgressEvent } from './generation';
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

/**
 * O que trafega no canal de progresso.
 *
 * Leva `userId` porque o canal é único para toda a instalação: a API assina uma
 * vez e distribui para as conexões SSE abertas, e é esse campo que decide para
 * quem cada evento vai. Sem ele, a alternativa seria um canal por usuário —
 * milhares de assinaturas no Redis para o mesmo efeito.
 */
export interface GenerationProgressMessage extends GenerationProgressEvent {
  userId: string;
}

export interface GenerationJob {
  generationId: string;
  songId: string;
  userId: string;
  kind: GenerationKind;
  /** Créditos já reservados no ledger; estornados se o job falhar. */
  reservedCredits: number;
  /** Faixa de origem em extend, remix e replace_section. */
  sourceSongId?: string;
  /** Descrição da capa, quando kind === 'cover'. */
  coverPrompt?: string;
  /**
   * O usuário nomeou a música, então o worker não deve renomeá-la.
   *
   * Sem isto, o título sugerido pelo modelo sobrescreve o escolhido por quem
   * pediu a música — inclusive quando o "título" que o modelo manda é o mapa de
   * seções da faixa. Quem digitou o nome espera vê-lo de volta.
   */
  titleFromUser?: boolean;
}

/** Edições mecânicas: rodam em FFmpeg no nosso worker e não custam crédito. */
export const EDIT_OPERATIONS = [
  'crop',
  'trim-silence',
  'fade-in',
  'fade-out',
  'speed',
  'reverse',
  'normalize',
] as const;
export type EditOperation = (typeof EDIT_OPERATIONS)[number];

export interface EditJob {
  songId: string;
  userId: string;
  operation: EditOperation;
  /**
   * Parâmetros da operação, em números: `startMs`/`endMs` no corte,
   * `durationMs` nos fades, `factor` na velocidade. Vazio em reverse e normalize.
   */
  params: Record<string, number>;
}

export interface TranscodeJob {
  songId: string;
  format: AudioFormat;
  /** Quem pediu, para notificar quando ficar pronto. */
  userId: string;
  /** Identifica a rendição junto com o formato. 0 = formato de versão única. */
  bitrate: number;
  /** Args do FFmpeg já resolvidos pela API, que conhece o plano do usuário. */
  ffmpegArgs: readonly string[];
}

export interface StemsJob {
  songId: string;
  userId: string;
  kinds: readonly StemKind[];
}

/**
 * Monta um id de job estável (usado para deduplicar: o BullMQ descarta um job
 * cujo id já existe na fila).
 *
 * O separador é `-`, e não `:`, por causa de uma regra traiçoeira do BullMQ:
 * ele aceita `:` no id APENAS quando o resultado tem exatamente 3 partes —
 * resquício de compatibilidade com jobs repetíveis antigos. Então
 * `musica:mp3:128` passa e `musica:crop` falha com "Custom Id cannot contain :".
 * Dois ids irmãos com comportamento diferente é exatamente o tipo de armadilha
 * que se paga em produção; aqui não usamos `:` em id nenhum.
 */
export function jobId(...partes: (string | number)[]): string {
  return partes.map((p) => String(p).replace(/:/g, '-')).join('-');
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
