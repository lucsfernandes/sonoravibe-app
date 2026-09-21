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
// O bitrate entra na chave porque o MP3 existe em duas qualidades: 128 kbps
// no Free e 320 nos pagos. Formatos de versão única usam 0 — e não null,
// porque o Postgres considera NULLs distintos e o índice não barraria duplicata.
@Index(['songId', 'format', 'bitrate'], { unique: true })
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

  @Column({ type: 'integer', default: 0 })
  bitrate: number;

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
