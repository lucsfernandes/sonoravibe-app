import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  AdvancedControls,
  GenerationKind,
  GenerationStatus,
} from '@sonora/shared';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';
import type { SongRendition } from './song-rendition.entity';
import type { Generation } from './generation.entity';
import type { Stem } from './stem.entity';

@Entity({ name: 'songs' })
@Index(['userId', 'createdAt'])
@Index(['isPublic', 'publishedAt'])
@Index(['workspaceId', 'createdAt'])
export class Song {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.songs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'workspace_id', nullable: true })
  workspaceId: string | null;

  @ManyToOne(() => Workspace, (ws) => ws.songs, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace | null;

  /**
   * Origem quando a faixa nasce de outra: remix, extend, cover ou replace_section.
   * A linhagem de uma música é uma árvore.
   */
  @Column({ type: 'uuid', name: 'parent_song_id', nullable: true })
  parentSongId: string | null;

  @ManyToOne(() => Song, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_song_id' })
  parentSong: Song | null;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  /** Prompt de estilo escrito pelo usuário (aba Advanced) ou a descrição (aba Simple). */
  @Column({ type: 'text', name: 'style_prompt', nullable: true })
  stylePrompt: string | null;

  /** Estilos/elementos que o usuário pediu para evitar. */
  @Column({ type: 'text', name: 'exclude_styles', nullable: true })
  excludeStyles: string | null;

  @Column({ type: 'text', nullable: true })
  lyrics: string | null;

  @Column({ type: 'boolean', default: false })
  instrumental: boolean;

  @Column({ type: 'varchar', length: 32, default: 'queued' })
  status: GenerationStatus;

  @Column({ type: 'varchar', length: 32, default: 'song' })
  kind: GenerationKind;

  @Column({ type: 'integer', name: 'duration_ms', default: 0 })
  durationMs: number;

  /** Chave do master no R2. Null enquanto a geração não terminou. */
  @Column({ type: 'text', name: 'master_key', nullable: true })
  masterKey: string | null;

  @Column({ type: 'text', name: 'cover_key', nullable: true })
  coverKey: string | null;

  /** Controles da UI usados nesta geração, guardados para permitir "gerar de novo". */
  @Column({ type: 'jsonb', nullable: true })
  params: Partial<AdvancedControls> | null;

  /** Prompt final enviado ao provedor, após o Prompt Compiler. Útil para suporte. */
  @Column({ type: 'text', name: 'compiled_prompt', nullable: true })
  compiledPrompt: string | null;

  @Column({ type: 'varchar', length: 40, name: 'provider_id', nullable: true })
  providerId: string | null;

  /**
   * Forma de onda: WAVEFORM_POINTS valores de 0 a 1, calculados pelo worker
   * quando o master fica pronto. É o que o modo "onda" da biblioteca desenha.
   * Null nas faixas de antes desta coluna; a interface pede o cálculo ao vê-las.
   */
  @Column({ type: 'jsonb', nullable: true })
  waveform: number[] | null;

  // --- Publicação e social --------------------------------------------------

  @Column({ type: 'boolean', name: 'is_public', default: false })
  isPublic: boolean;

  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'boolean', name: 'allow_remixes', default: true })
  allowRemixes: boolean;

  @Column({ type: 'boolean', name: 'allow_comments', default: true })
  allowComments: boolean;

  @Column({ type: 'integer', name: 'play_count', default: 0 })
  playCount: number;

  @Column({ type: 'integer', name: 'like_count', default: 0 })
  likeCount: number;

  @Column({ type: 'integer', name: 'comment_count', default: 0 })
  commentCount: number;

  // --- Relações -------------------------------------------------------------

  @OneToMany('SongRendition', (r: SongRendition) => r.song)
  renditions: SongRendition[];

  @OneToMany('Generation', (g: Generation) => g.song)
  generations: Generation[];

  @OneToMany('Stem', (s: Stem) => s.song)
  stems: Stem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Lixeira: a música some da biblioteca mas o arquivo só é apagado depois de 30 dias. */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
