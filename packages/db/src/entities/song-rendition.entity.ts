import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AudioFormat } from '@sonora/shared';
import { Song } from './song.entity';

/**
 * Um arquivo de áudio derivado do master, num formato específico.
 *
 * O MP3 é o próprio master do Lyria, sem reencode (preserva o C2PA). WAV, FLAC, OPUS e M4A são
 * transcodificados sob demanda e expiram depois de RENDITION_CACHE_DAYS —
 * guardar todos de antemão multiplicaria o storage por ~5 sem necessidade.
 */
@Entity({ name: 'song_renditions' })
@Index(['songId', 'format'], { unique: true })
@Index(['expiresAt'])
export class SongRendition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'song_id' })
  songId: string;

  @ManyToOne(() => Song, (song) => song.renditions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song: Song;

  @Column({ type: 'varchar', length: 8 })
  format: AudioFormat;

  @Column({ type: 'integer', nullable: true })
  bitrate: number | null;

  @Column({ type: 'text', name: 'storage_key' })
  storageKey: string;

  @Column({ type: 'bigint', name: 'size_bytes', default: 0 })
  sizeBytes: string;

  /** Null = permanente (o MP3 eager). Preenchido = cache com validade. */
  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
