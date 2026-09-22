import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Profile, User } from '@sonora/db';
import { StorageService, storageKeys } from '@sonora/storage';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { STORAGE } from '../storage/storage.module';

export interface MeView {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  locale: string;
}

/** Tipos de imagem aceitos como foto de perfil. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Teto da foto. A interface reduz para 512px antes de enviar; isto é a rede de segurança. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * O próprio usuário: o que o menu da barra lateral mostra e edita.
 *
 * Nome, bio e foto vivem no perfil público (`profiles`); o nome também vai
 * para a tabela do Better Auth, que é de onde a sessão o lê. Atualizar só um
 * dos dois deixaria o menu dizendo um nome e a página do perfil outro.
 *
 * A foto do Google (`user.image`) só serve de reserva enquanto a pessoa não
 * envia a própria: nunca é sobrescrita nem apagada por aqui.
 */
@Injectable()
export class MeService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STORAGE) private readonly storage: StorageService,
  ) {}

  async get(userId: string): Promise<MeView> {
    const [user, profile] = await Promise.all([
      this.dataSource.getRepository(User).findOneBy({ id: userId }),
      this.dataSource.getRepository(Profile).findOneBy({ userId }),
    ]);
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    return {
      id: user.id,
      email: user.email,
      handle: profile?.handle ?? '',
      displayName: profile?.displayName ?? user.name,
      bio: profile?.bio ?? null,
      avatarUrl: profile?.avatarKey
        ? await this.storage.presignGet(profile.avatarKey)
        : (user.image ?? null),
      locale: profile?.locale ?? 'pt-BR',
    };
  }

  async update(userId: string, patch: { name?: string; bio?: string | null }): Promise<MeView> {
    await this.dataSource.transaction(async (em) => {
      if (patch.name !== undefined) {
        await em.getRepository(User).update({ id: userId }, { name: patch.name });
        await em.getRepository(Profile).update({ userId }, { displayName: patch.name.slice(0, 80) });
      }
      if (patch.bio !== undefined) {
        await em.getRepository(Profile).update({ userId }, { bio: patch.bio?.trim() || null });
      }
    });
    return this.get(userId);
  }

  async setAvatar(
    userId: string,
    file: Buffer,
    contentType: string | undefined,
  ): Promise<{ avatarUrl: string }> {
    const tipo = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!IMAGE_TYPES.has(tipo)) {
      throw new BadRequestException('Envie uma imagem JPEG, PNG ou WebP.');
    }
    if (!file || file.byteLength === 0) throw new BadRequestException('A imagem chegou vazia.');
    if (file.byteLength > MAX_AVATAR_BYTES) {
      throw new BadRequestException('A imagem passa de 5 MB.');
    }

    const profile = await this.dataSource.getRepository(Profile).findOneBy({ userId });
    if (!profile) throw new NotFoundException('Perfil não encontrado.');

    const key = storageKeys.avatar(userId);
    await this.storage.putObject(key, file, tipo);
    await this.dataSource.getRepository(Profile).update({ userId }, { avatarKey: key });

    return { avatarUrl: await this.storage.presignGet(key) };
  }

  async removeAvatar(userId: string): Promise<void> {
    const profile = await this.dataSource.getRepository(Profile).findOneBy({ userId });
    if (!profile?.avatarKey) return;
    await this.dataSource.getRepository(Profile).update({ userId }, { avatarKey: null });
    // O objeto some depois do banco: se a exclusão no R2 falhar, a foto só
    // fica órfã no bucket, e não apontada por um perfil.
    await this.storage.deleteObject(profile.avatarKey).catch(() => undefined);
  }
}
