import { CreditTransaction } from './entities/credit-transaction.entity';
import { CreditWallet } from './entities/credit-wallet.entity';
import { Generation } from './entities/generation.entity';
import { Payment } from './entities/payment.entity';
import { Playlist, PlaylistSong } from './entities/playlist.entity';
import { Profile } from './entities/profile.entity';
import {
  Follow,
  Play,
  SongComment,
  SongLike,
  StylePreset,
} from './entities/social.entity';
import { SongRendition } from './entities/song-rendition.entity';
import { Song } from './entities/song.entity';
import { Stem } from './entities/stem.entity';
import { Subscription } from './entities/subscription.entity';
import { User } from './entities/user.entity';
import { Workspace } from './entities/workspace.entity';

export * from './entities/credit-transaction.entity';
export * from './entities/credit-wallet.entity';
export * from './entities/generation.entity';
export * from './entities/payment.entity';
export * from './entities/playlist.entity';
export * from './entities/profile.entity';
export * from './entities/social.entity';
export * from './entities/song-rendition.entity';
export * from './entities/song.entity';
export * from './entities/stem.entity';
export * from './entities/subscription.entity';
export * from './entities/user.entity';
export * from './entities/workspace.entity';

/**
 * Registro central das entidades.
 * A API e o worker importam daqui para configurar o TypeORM — manter uma única
 * lista evita o clássico "entity metadata not found" quando alguém esquece
 * de registrar numa das duas aplicações.
 */
export const ENTITIES = [
  User,
  Profile,
  Workspace,
  Song,
  SongRendition,
  Generation,
  Stem,
  CreditWallet,
  CreditTransaction,
  Subscription,
  Payment,
  Playlist,
  PlaylistSong,
  SongLike,
  SongComment,
  Follow,
  Play,
  StylePreset,
];
