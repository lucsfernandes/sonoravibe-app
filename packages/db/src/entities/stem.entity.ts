import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { StemKind } from '@sonora/shared';
import { Song } from './song.entity';

/** Faixa isolada produzida pelo Demucs (vocal, bateria, baixo, outros). */
@Entity({ name: 'stems' })
@Index(['songId', 'kind'], { unique: true })
export class Stem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'song_id' })
  songId: string;

  @ManyToOne(() => Song, (song) => song.stems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song: Song;

  @Column({ type: 'varchar', length: 16 })
  kind: StemKind;

  @Column({ type: 'text', name: 'storage_key' })
  storageKey: string;

  @Column({ type: 'bigint', name: 'size_bytes', default: 0 })
  sizeBytes: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
