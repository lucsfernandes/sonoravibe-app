import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { GenerationKind, GenerationStatus } from '@sonora/shared';
import { Song } from './song.entity';
import { User } from './user.entity';

/**
 * Uma tentativa de geração. Existe separada de Song porque uma mesma música
 * pode ter várias tentativas (retry após falha) e porque o estorno de crédito
 * precisa de um registro próprio para ser auditável.
 */
@Entity({ name: 'generations' })
@Index(['userId', 'createdAt'])
@Index(['status'])
export class Generation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'song_id' })
  songId: string;

  @ManyToOne(() => Song, (song) => song.generations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song: Song;

  @Column({ type: 'text', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 32 })
  kind: GenerationKind;

  @Column({ type: 'varchar', length: 32, default: 'queued' })
  status: GenerationStatus;

  /** Qual MusicProvider atendeu — 'lyria-pro', 'lyria-clip', 'mock'. */
  @Column({ type: 'varchar', length: 40, name: 'provider_id' })
  providerId: string;

  /** Identificador do lado do provedor, para rastrear no suporte. */
  @Column({ type: 'varchar', length: 200, name: 'provider_ref', nullable: true })
  providerRef: string | null;

  /** Créditos reservados no momento do enfileiramento. */
  @Column({ type: 'integer', name: 'credits_charged', default: 0 })
  creditsCharged: number;

  /** true depois que o estorno foi lançado no ledger. Evita estorno duplo. */
  @Column({ type: 'boolean', default: false })
  refunded: boolean;

  @Column({ type: 'text', name: 'compiled_prompt', nullable: true })
  compiledPrompt: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'integer', name: 'attempt_count', default: 0 })
  attemptCount: number;

  /** ID do job no BullMQ, para cancelar e consultar. */
  @Column({ type: 'varchar', length: 100, name: 'job_id', nullable: true })
  jobId: string | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
