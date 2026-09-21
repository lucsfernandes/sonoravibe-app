import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Profile } from './profile.entity';
import type { Song } from './song.entity';
import type { Workspace } from './workspace.entity';
import type { CreditWallet } from './credit-wallet.entity';
import type { Subscription } from './subscription.entity';

/**
 * Tabela gerenciada pelo Better Auth.
 *
 * O schema (nome da tabela, colunas e tipos) é criado pelas migrations do
 * Better Auth — esta entidade existe só para o TypeORM montar as relações do
 * domínio. `synchronize: false` impede que o TypeORM tente criar ou alterar a
 * tabela: dois donos para o mesmo schema acabam em ALTER de ida e volta a cada
 * subida. NÃO altere colunas aqui sem alterar a config do Better Auth junto.
 */
@Entity({ name: 'user', synchronize: false })
export class User {
  /** Better Auth gera IDs como string, não UUID. */
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'boolean', name: 'emailVerified', default: false })
  emailVerified: boolean;

  @Column({ type: 'text', nullable: true })
  image: string | null;

  @CreateDateColumn({ name: 'createdAt', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne('Profile', (profile: Profile) => profile.user)
  profile: Profile;

  @OneToOne('CreditWallet', (wallet: CreditWallet) => wallet.user)
  wallet: CreditWallet;

  @OneToMany('Workspace', (workspace: Workspace) => workspace.user)
  workspaces: Workspace[];

  @OneToMany('Song', (song: Song) => song.user)
  songs: Song[];

  @OneToMany('Subscription', (sub: Subscription) => sub.user)
  subscriptions: Subscription[];
}
