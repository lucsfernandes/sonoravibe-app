import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/** Perfil público do usuário — o que aparece em /@handle. */
@Entity({ name: 'profiles' })
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'user_id', unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Identificador na URL pública. Minúsculo, sem espaços. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40 })
  handle: string;

  @Column({ type: 'varchar', length: 80 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  /** Chave do avatar no R2. */
  @Column({ type: 'text', name: 'avatar_key', nullable: true })
  avatarKey: string | null;

  /** Música destacada no topo do perfil. */
  @Column({ type: 'uuid', name: 'pinned_song_id', nullable: true })
  pinnedSongId: string | null;

  @Column({ type: 'integer', name: 'follower_count', default: 0 })
  followerCount: number;

  @Column({ type: 'integer', name: 'following_count', default: 0 })
  followingCount: number;

  /** Idioma preferido da interface. */
  @Column({ type: 'varchar', length: 5, default: 'pt-BR' })
  locale: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
