import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Song } from './song.entity';
import { User } from './user.entity';

/** Curtida. Chave composta impede curtir duas vezes sem precisar de unique extra. */
@Entity({ name: 'song_likes' })
@Index(['songId', 'createdAt'])
export class SongLike {
  @PrimaryColumn({ type: 'text', name: 'user_id' })
  userId: string;

  @PrimaryColumn({ type: 'uuid', name: 'song_id' })
  songId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song: Song;

  /** Suno tem joinha e deslike; guardamos o sinal para alimentar o "For You". */
  @Column({ type: 'smallint', default: 1 })
  value: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export type CommentStatus = 'visible' | 'hidden' | 'reported' | 'removed';

@Entity({ name: 'song_comments' })
@Index(['songId', 'createdAt'])
export class SongComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'song_id' })
  songId: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song: Song;

  @Column({ type: 'text', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Resposta a outro comentário. */
  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parentId: string | null;

  @Column({ type: 'text' })
  body: string;

  /** Moderação por LLM na publicação marca como 'hidden' quando reprova. */
  @Column({ type: 'varchar', length: 16, default: 'visible' })
  status: CommentStatus;

  /** Momento da música ao qual o comentário se refere, em ms. */
  @Column({ type: 'integer', name: 'timestamp_ms', nullable: true })
  timestampMs: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'follows' })
@Index(['followingId', 'createdAt'])
export class Follow {
  @PrimaryColumn({ type: 'text', name: 'follower_id' })
  followerId: string;

  @PrimaryColumn({ type: 'text', name: 'following_id' })
  followingId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'follower_id' })
  follower: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'following_id' })
  following: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/**
 * Registro de reprodução.
 *
 * Alimenta o ranking do Explore e o Song Radio. Gravado de forma assíncrona
 * (fila) para não pesar no player; deduplicado por (user, song, janela de 30s).
 */
@Entity({ name: 'plays' })
@Index(['songId', 'createdAt'])
export class Play {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'song_id' })
  songId: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song: Song;

  /** Null para ouvinte anônimo. */
  @Column({ type: 'text', name: 'user_id', nullable: true })
  userId: string | null;

  /** Quanto da música foi ouvido, em ms. Play curto não conta para o ranking. */
  @Column({ type: 'integer', name: 'listened_ms', default: 0 })
  listenedMs: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** Estilo salvo pelo usuário para reutilizar — aba "Styles" da biblioteca. */
@Entity({ name: 'style_presets' })
@Index(['userId', 'createdAt'])
export class StylePreset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'text', name: 'exclude_styles', nullable: true })
  excludeStyles: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
