import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Song } from './song.entity';
import { User } from './user.entity';

@Entity({ name: 'playlists' })
@Index(['userId', 'createdAt'])
export class Playlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', name: 'cover_key', nullable: true })
  coverKey: string | null;

  @Column({ type: 'boolean', name: 'is_public', default: false })
  isPublic: boolean;

  @Column({ type: 'integer', name: 'song_count', default: 0 })
  songCount: number;

  @OneToMany(() => PlaylistSong, (ps) => ps.playlist)
  items: PlaylistSong[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity({ name: 'playlist_songs' })
@Index(['playlistId', 'position'])
export class PlaylistSong {
  @PrimaryColumn({ type: 'uuid', name: 'playlist_id' })
  playlistId: string;

  @PrimaryColumn({ type: 'uuid', name: 'song_id' })
  songId: string;

  @ManyToOne(() => Playlist, (p) => p.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlist_id' })
  playlist: Playlist;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song: Song;

  /** Ordem dentro da playlist. Reordenar reescreve esta coluna. */
  @Column({ type: 'integer', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
