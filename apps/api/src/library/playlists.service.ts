import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Playlist, PlaylistSong, Song } from '@sonora/db';
import { StorageService } from '@sonora/storage';
import { DataSource, In } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { STORAGE } from '../storage/storage.module';

export interface PlaylistDetail {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  songCount: number;
  createdAt: Date;
  songs: {
    id: string;
    title: string;
    durationMs: number;
    position: number;
    audioUrl: string | null;
    coverUrl: string | null;
  }[];
}

@Injectable()
export class PlaylistsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STORAGE) private readonly storage: StorageService,
  ) {}

  list(userId: string): Promise<Playlist[]> {
    return this.dataSource
      .getRepository(Playlist)
      .find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  create(
    userId: string,
    data: { name: string; description?: string; isPublic: boolean },
  ): Promise<Playlist> {
    const repo = this.dataSource.getRepository(Playlist);
    return repo.save(
      repo.create({
        userId,
        name: data.name,
        description: data.description ?? null,
        isPublic: data.isPublic,
      }),
    );
  }

  async findOne(userId: string, id: string): Promise<PlaylistDetail> {
    const playlist = await this.own(userId, id);

    const entries = await this.dataSource.getRepository(PlaylistSong).find({
      where: { playlistId: id },
      order: { position: 'ASC' },
    });

    const songs = entries.length
      ? await this.dataSource
          .getRepository(Song)
          .findBy({ id: In(entries.map((e) => e.songId)) })
      : [];
    const porId = new Map(songs.map((s) => [s.id, s]));

    return {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      isPublic: playlist.isPublic,
      songCount: playlist.songCount,
      createdAt: playlist.createdAt,
      songs: await Promise.all(
        entries
          // Uma música na lixeira sai da playlist na leitura, sem precisar
          // varrer todas as playlists no momento da exclusão.
          .filter((entry) => porId.has(entry.songId))
          .map(async (entry) => {
            const song = porId.get(entry.songId) as Song;
            return {
              id: song.id,
              title: song.title,
              durationMs: song.durationMs,
              position: entry.position,
              audioUrl: song.masterKey ? await this.storage.presignGet(song.masterKey) : null,
              coverUrl: song.coverKey ? await this.storage.presignGet(song.coverKey) : null,
            };
          }),
      ),
    };
  }

  async update(
    userId: string,
    id: string,
    patch: { name?: string; description?: string; isPublic?: boolean },
  ): Promise<Playlist> {
    const playlist = await this.own(userId, id);
    Object.assign(playlist, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.isPublic !== undefined ? { isPublic: patch.isPublic } : {}),
    });
    return this.dataSource.getRepository(Playlist).save(playlist);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.own(userId, id);
    await this.dataSource.getRepository(Playlist).delete({ id });
  }

  /**
   * Adiciona no fim da playlist.
   *
   * A posição e o contador são calculados dentro da transação: duas abas
   * adicionando ao mesmo tempo produziriam duas faixas na mesma posição e um
   * songCount errado.
   */
  async addSong(userId: string, playlistId: string, songId: string): Promise<{ position: number }> {
    await this.own(userId, playlistId);

    // Playlist pode conter música de outra pessoa, desde que pública.
    const song = await this.dataSource.getRepository(Song).findOneBy({ id: songId });
    if (!song || (song.userId !== userId && !song.isPublic)) {
      throw new NotFoundException('Música não encontrada.');
    }

    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(PlaylistSong);

      if (await repo.existsBy({ playlistId, songId })) {
        throw new ConflictException('Esta música já está na playlist.');
      }

      const ultima = await repo.findOne({
        where: { playlistId },
        order: { position: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      const position = (ultima?.position ?? -1) + 1;

      await repo.save(repo.create({ playlistId, songId, position }));
      await em.getRepository(Playlist).increment({ id: playlistId }, 'songCount', 1);

      return { position };
    });
  }

  async removeSong(userId: string, playlistId: string, songId: string): Promise<void> {
    await this.own(userId, playlistId);
    await this.dataSource.transaction(async (em) => {
      const { affected } = await em.getRepository(PlaylistSong).delete({ playlistId, songId });
      if (!affected) throw new NotFoundException('Música não está nesta playlist.');
      await em.getRepository(Playlist).decrement({ id: playlistId }, 'songCount', 1);
    });
  }

  /** Reescreve a ordem inteira: é o formato que o arrastar-e-soltar produz. */
  async reorder(userId: string, playlistId: string, songIds: string[]): Promise<PlaylistDetail> {
    await this.own(userId, playlistId);

    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(PlaylistSong);
      const atuais = await repo.findBy({ playlistId });
      const conhecidas = new Set(atuais.map((e) => e.songId));

      const desconhecidas = songIds.filter((id) => !conhecidas.has(id));
      if (desconhecidas.length > 0) {
        throw new NotFoundException(
          `Estas músicas não estão na playlist: ${desconhecidas.join(', ')}`,
        );
      }

      for (const [i, songId] of songIds.entries()) {
        await repo.update({ playlistId, songId }, { position: i });
      }

      // O que o cliente não listou vai para o fim, preservando a ordem anterior.
      // A chave primária é (playlistId, songId): não existe coluna `id` aqui.
      const restantes = atuais
        .filter((e) => !songIds.includes(e.songId))
        .sort((a, b) => a.position - b.position);
      for (const [i, entry] of restantes.entries()) {
        await repo.update(
          { playlistId, songId: entry.songId },
          { position: songIds.length + i },
        );
      }
    });

    return this.findOne(userId, playlistId);
  }

  private async own(userId: string, id: string): Promise<Playlist> {
    const playlist = await this.dataSource.getRepository(Playlist).findOneBy({ id, userId });
    if (!playlist) throw new NotFoundException('Playlist não encontrada.');
    return playlist;
  }
}
