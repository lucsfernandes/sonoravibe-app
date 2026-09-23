import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Follow, Play, Profile, Song, SongComment, SongLike } from '@sonora/db';
import { StorageService } from '@sonora/storage';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { REDIS } from '../queue/queue.module';
import { STORAGE } from '../storage/storage.module';

export type ExploreTab = 'trending' | 'new' | 'following';

export interface ExploreItem {
  id: string;
  title: string;
  /**
   * `status` e `isPublic` viajam mesmo sendo sempre 'complete' e true aqui: o
   * mesmo cartão da interface renderiza itens do Explore e da biblioteca, e sem
   * estes campos ele concluía "não está pronta" e "é privada" — mostrando
   * "carregando" e um selo de privada numa faixa pública.
   */
  status: string;
  isPublic: boolean;
  durationMs: number;
  stylePrompt: string | null;
  playCount: number;
  likeCount: number;
  commentCount: number;
  audioUrl: string | null;
  coverUrl: string | null;
  publishedAt: Date | null;
  author: { handle: string; displayName: string; avatarUrl: string | null };
  likedByMe: boolean;
  allowRemixes: boolean;
}

/** As duas listas da lateral da página da música. */
export interface RelatedSongs {
  /** Públicas de outras pessoas, com estilo parecido. */
  similar: ExploreItem[];
  /** Outras públicas do mesmo autor. */
  byAuthor: ExploreItem[];
}

/**
 * Palavras que não dizem nada sobre o estilo. Curta de propósito: o objetivo
 * não é analisar texto, é evitar que "with" e "com" casem com tudo.
 */
const PALAVRAS_VAZIAS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'over',
  'the', 'to', 'with', 'without', 'very', 'some', 'like',
  'com', 'sem', 'para', 'por', 'uma', 'um', 'das', 'dos', 'de', 'da', 'do', 'que', 'mais',
  'muito', 'como', 'e', 'ou', 'em', 'na', 'no', 'nas', 'nos', 'bem', 'bpm',
]);

/** Quantos termos entram na busca de similares. Mais que isso só encarece a consulta. */
const MAX_TERMOS_ESTILO = 8;

/**
 * Termos de um prompt de estilo, para achar músicas parecidas.
 *
 * Divide em palavras, tira as vazias, as curtas e os números (o "62" de
 * "62 BPM" casaria com qualquer estilo que cite um andamento) e deduplica.
 * É deliberadamente simples: "ambient, warm synths, unhurried" precisa casar
 * com "ambient, spacious synths", e uma busca por frase inteira não casa.
 */
export function termosDeEstilo(stylePrompt: string | null | undefined): string[] {
  if (!stylePrompt) return [];
  const vistos = new Set<string>();
  for (const bruto of stylePrompt.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const termo = bruto.trim();
    if (termo.length < 3 || /^\d+$/.test(termo) || PALAVRAS_VAZIAS.has(termo)) continue;
    vistos.add(termo);
    if (vistos.size === MAX_TERMOS_ESTILO) break;
  }
  return [...vistos];
}

/** Janela em que reproduções do mesmo ouvinte na mesma música não contam de novo. */
const PLAY_DEDUP_SECONDS = 30;

/** Tempo mínimo de escuta para a reprodução contar. */
const MIN_LISTENED_MS = 5_000;

/**
 * Explore, perfis e interações.
 *
 * O ranking de "trending" mistura reproduções e curtidas com decaimento pelo
 * tempo desde a publicação. Sem o decaimento, as primeiras músicas populares
 * ocupariam o topo para sempre e nada novo apareceria.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STORAGE) private readonly storage: StorageService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async explore(
    viewerId: string | null,
    tab: ExploreTab,
    limit: number,
    q?: string,
  ): Promise<ExploreItem[]> {
    const qb = this.dataSource
      .getRepository(Song)
      .createQueryBuilder('song')
      .where('song.isPublic = true')
      .andWhere("song.status = 'complete'")
      .take(limit);

    const termo = q?.trim();
    if (termo) {
      qb.andWhere('(song.title ILIKE :q OR song.stylePrompt ILIKE :q)', {
        q: `%${termo.replace(/[\\%_]/g, '\\$&')}%`,
      });
    }

    if (tab === 'following') {
      if (!viewerId) return [];
      // Os seguidos vêm numa consulta própria, em vez de um JOIN: com JOIN + take
      // o TypeORM monta a consulta em duas fases e passa a exigir que tudo no
      // ORDER BY esteja no SELECT, o que quebra a expressão de popularidade.
      const seguidos = await this.dataSource
        .getRepository(Follow)
        .find({ where: { followerId: viewerId }, select: { followingId: true } });
      if (seguidos.length === 0) return [];
      qb.andWhere('song.userId IN (:...autores)', {
        autores: seguidos.map((f) => f.followingId),
      }).orderBy('song.publishedAt', 'DESC');
    } else if (tab === 'new') {
      qb.orderBy('song.publishedAt', 'DESC');
    } else {
      // Popularidade dividida pela idade: o expoente 1.5 faz o peso cair rápido
      // nas primeiras horas e devagar depois, que é como a atenção real se
      // comporta. Idade em horas + 2 evita divisão por zero no minuto zero.
      qb.addSelect(
        `(song.play_count + song.like_count * 5) /
         POWER(EXTRACT(EPOCH FROM (NOW() - COALESCE(song.published_at, song.created_at))) / 3600 + 2, 1.5)`,
        'relevancia',
      ).orderBy('relevancia', 'DESC');
    }

    return this.toExploreItems(viewerId, await qb.getMany());
  }

  /**
   * As listas da lateral da página de uma música: parecidas e do mesmo autor.
   *
   * "Parecida" é afinidade de termos do estilo: cada termo do prompt desta
   * música que aparece no prompt da outra soma um ponto, e a lista sai por
   * pontos e depois por reproduções. Sem termos (upload sem estilo, por
   * exemplo) ou sem nenhuma coincidência, entram as mais tocadas do catálogo:
   * uma lateral vazia numa página pública parece defeito.
   *
   * Só músicas PÚBLICAS: é uma lista que qualquer visitante vê, e a do próprio
   * autor não pode vazar as privadas dele por aqui.
   */
  async related(viewerId: string | null, songId: string, limit = 12): Promise<RelatedSongs> {
    const song = await this.publicSong(songId, viewerId);

    const base = () =>
      this.dataSource
        .getRepository(Song)
        .createQueryBuilder('song')
        .where('song.isPublic = true')
        .andWhere("song.status = 'complete'")
        .andWhere('song.id != :id', { id: song.id })
        .take(limit);

    const doAutor = base()
      .andWhere('song.userId = :autor', { autor: song.userId })
      .orderBy('song.publishedAt', 'DESC');

    const termos = termosDeEstilo(song.stylePrompt);
    let parecidas: Song[] = [];
    if (termos.length > 0) {
      const afinidade = termos
        .map((_, i) => `(CASE WHEN song.style_prompt ILIKE :termo${i} THEN 1 ELSE 0 END)`)
        .join(' + ');
      const parametros = Object.fromEntries(
        termos.map((termo, i) => [`termo${i}`, `%${termo.replace(/[\\%_]/g, '\\$&')}%`]),
      );
      parecidas = await base()
        .andWhere('song.userId != :autor', { autor: song.userId })
        .andWhere(`(${afinidade}) > 0`, parametros)
        .addSelect(`(${afinidade})`, 'afinidade')
        .orderBy('afinidade', 'DESC')
        .addOrderBy('song.playCount', 'DESC')
        .getMany();
    }
    if (parecidas.length === 0) {
      parecidas = await base()
        .andWhere('song.userId != :autor', { autor: song.userId })
        .orderBy('song.playCount', 'DESC')
        .addOrderBy('song.publishedAt', 'DESC')
        .getMany();
    }

    const [similar, byAuthor] = await Promise.all([
      this.toExploreItems(viewerId, parecidas),
      this.toExploreItems(viewerId, await doAutor.getMany()),
    ]);
    return { similar, byAuthor };
  }

  /** Faixas públicas no formato do Explore, com autor e curtida do visitante resolvidos de uma vez. */
  private async toExploreItems(viewerId: string | null, songs: Song[]): Promise<ExploreItem[]> {
    if (songs.length === 0) return [];

    const [autores, curtidas] = await Promise.all([
      this.profilesOf(songs.map((s) => s.userId), true),
      viewerId ? this.likedAmong(viewerId, songs.map((s) => s.id)) : Promise.resolve(new Set<string>()),
    ]);

    return Promise.all(
      songs.map(async (song) => {
        const autor = autores.get(song.userId);
        return {
          id: song.id,
          title: song.title,
          status: song.status,
          isPublic: song.isPublic,
          durationMs: song.durationMs,
          stylePrompt: song.stylePrompt,
          playCount: song.playCount,
          likeCount: song.likeCount,
          commentCount: song.commentCount,
          audioUrl: song.masterKey ? await this.storage.presignGet(song.masterKey) : null,
          coverUrl: song.coverKey ? await this.storage.presignGet(song.coverKey) : null,
          publishedAt: song.publishedAt,
          author: {
            handle: autor?.handle ?? 'desconhecido',
            displayName: autor?.displayName ?? 'Usuário',
            avatarUrl: autor?.avatarKey ? await this.storage.presignGet(autor.avatarKey) : null,
          },
          likedByMe: curtidas.has(song.id),
          // O "+ Áudio" só oferece como referência o que o autor liberou.
          allowRemixes: song.allowRemixes,
        };
      }),
    );
  }

  async profileOf(viewerId: string | null, handle: string) {
    const profile = await this.dataSource.getRepository(Profile).findOneBy({ handle });
    if (!profile) throw new NotFoundException('Perfil não encontrado.');

    const [songs, seguindo] = await Promise.all([
      this.dataSource.getRepository(Song).find({
        where: { userId: profile.userId, isPublic: true, status: 'complete' },
        order: { publishedAt: 'DESC' },
        take: 50,
      }),
      viewerId
        ? this.dataSource
            .getRepository(Follow)
            .existsBy({ followerId: viewerId, followingId: profile.userId })
        : Promise.resolve(false),
    ]);

    return {
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarKey ? await this.storage.presignGet(profile.avatarKey) : null,
      followerCount: profile.followerCount,
      followingCount: profile.followingCount,
      isMe: viewerId === profile.userId,
      followedByMe: seguindo,
      songs: await Promise.all(
        songs.map(async (song) => ({
          id: song.id,
          title: song.title,
          status: song.status,
          isPublic: song.isPublic,
          durationMs: song.durationMs,
          playCount: song.playCount,
          likeCount: song.likeCount,
          commentCount: song.commentCount,
          stylePrompt: song.stylePrompt,
          audioUrl: song.masterKey ? await this.storage.presignGet(song.masterKey) : null,
          coverUrl: song.coverKey ? await this.storage.presignGet(song.coverKey) : null,
          publishedAt: song.publishedAt,
        })),
      ),
    };
  }

  /**
   * Curtir/descurtir. Devolve o estado final para a UI não precisar adivinhar
   * — clique duplo rápido não deixa o coração fora de sincronia.
   */
  async toggleLike(userId: string, songId: string): Promise<{ liked: boolean; likeCount: number }> {
    const song = await this.publicSong(songId, userId);

    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(SongLike);
      const existente = await repo.findOneBy({ songId, userId });

      if (existente) {
        await repo.delete({ songId, userId });
        await em.getRepository(Song).decrement({ id: songId }, 'likeCount', 1);
        return { liked: false, likeCount: Math.max(0, song.likeCount - 1) };
      }

      await repo.save(repo.create({ songId, userId }));
      await em.getRepository(Song).increment({ id: songId }, 'likeCount', 1);
      return { liked: true, likeCount: song.likeCount + 1 };
    });
  }

  async comments(viewerId: string | null, songId: string) {
    const song = await this.publicSong(songId, viewerId);

    const comments = await this.dataSource.getRepository(SongComment).find({
      where: { songId, status: 'visible' },
      order: { createdAt: 'ASC' },
      take: 200,
    });

    const autores = await this.profilesOf(comments.map((c) => c.userId));

    return {
      allowed: song.allowComments,
      items: comments.map((c) => ({
        id: c.id,
        body: c.body,
        timestampMs: c.timestampMs,
        parentId: c.parentId,
        createdAt: c.createdAt,
        author: autores.get(c.userId) ?? { handle: 'desconhecido', displayName: 'Usuário' },
        isMine: c.userId === viewerId,
      })),
    };
  }

  async comment(
    userId: string,
    songId: string,
    data: { body: string; timestampMs?: number; parentId?: string },
  ) {
    const song = await this.publicSong(songId, userId);
    if (!song.allowComments) {
      throw new ForbiddenException('O autor desativou os comentários nesta música.');
    }

    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(SongComment);
      const comment = await repo.save(
        repo.create({
          songId,
          userId,
          body: data.body,
          timestampMs: data.timestampMs ?? null,
          parentId: data.parentId ?? null,
          status: 'visible',
        }),
      );
      await em.getRepository(Song).increment({ id: songId }, 'commentCount', 1);
      return { id: comment.id, createdAt: comment.createdAt };
    });
  }

  async removeComment(userId: string, songId: string, commentId: string): Promise<void> {
    const comment = await this.dataSource
      .getRepository(SongComment)
      .findOneBy({ id: commentId, songId });
    if (!comment) throw new NotFoundException('Comentário não encontrado.');

    // Apaga quem escreveu — ou o dono da música, que modera o próprio espaço.
    const song = await this.dataSource.getRepository(Song).findOneBy({ id: songId });
    if (comment.userId !== userId && song?.userId !== userId) {
      throw new ForbiddenException('Você não pode apagar este comentário.');
    }

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(SongComment).delete({ id: commentId });
      await em.getRepository(Song).decrement({ id: songId }, 'commentCount', 1);
    });
  }

  async toggleFollow(
    followerId: string,
    handle: string,
  ): Promise<{ following: boolean; followerCount: number }> {
    const profile = await this.dataSource.getRepository(Profile).findOneBy({ handle });
    if (!profile) throw new NotFoundException('Perfil não encontrado.');
    if (profile.userId === followerId) {
      throw new ForbiddenException('Não dá para seguir a si mesmo.');
    }

    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(Follow);
      const existente = await repo.findOneBy({ followerId, followingId: profile.userId });
      const profiles = em.getRepository(Profile);

      if (existente) {
        await repo.delete({ followerId, followingId: profile.userId });
        await profiles.decrement({ userId: profile.userId }, 'followerCount', 1);
        await profiles.decrement({ userId: followerId }, 'followingCount', 1);
        return { following: false, followerCount: Math.max(0, profile.followerCount - 1) };
      }

      await repo.save(repo.create({ followerId, followingId: profile.userId }));
      await profiles.increment({ userId: profile.userId }, 'followerCount', 1);
      await profiles.increment({ userId: followerId }, 'followingCount', 1);
      return { following: true, followerCount: profile.followerCount + 1 };
    });
  }

  /**
   * Registra uma reprodução.
   *
   * Duas defesas contra inflar o número: escuta mínima de 5 s (um clique sem
   * ouvir não conta) e deduplicação por janela de 30 s no Redis, com chave por
   * ouvinte e música. Sem isso, recarregar a página em loop empurraria qualquer
   * faixa para o topo do Explore.
   */
  async registerPlay(
    listenerId: string | null,
    songId: string,
    listenedMs: number,
    fingerprint: string,
  ): Promise<{ counted: boolean }> {
    if (listenedMs < MIN_LISTENED_MS) return { counted: false };

    const song = await this.dataSource.getRepository(Song).findOneBy({ id: songId });
    if (!song || (!song.isPublic && song.userId !== listenerId)) {
      throw new NotFoundException('Música não encontrada.');
    }

    const chave = `sonora:play:${songId}:${listenerId ?? fingerprint}`;
    const primeiro = await this.redis.set(chave, '1', 'EX', PLAY_DEDUP_SECONDS, 'NX');
    if (!primeiro) return { counted: false };

    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(Play);
      await repo.save(repo.create({ songId, userId: listenerId, listenedMs }));
      await em.getRepository(Song).increment({ id: songId }, 'playCount', 1);
    });

    return { counted: true };
  }

  private async publicSong(songId: string, viewerId: string | null): Promise<Song> {
    const song = await this.dataSource.getRepository(Song).findOneBy({ id: songId });
    if (!song || (!song.isPublic && song.userId !== viewerId)) {
      throw new NotFoundException('Música não encontrada.');
    }
    return song;
  }

  private async likedAmong(userId: string, songIds: string[]): Promise<Set<string>> {
    if (songIds.length === 0) return new Set();
    const likes = await this.dataSource
      .getRepository(SongLike)
      .createQueryBuilder('like')
      .select('like.songId', 'songId')
      .where('like.userId = :userId', { userId })
      .andWhere('like.songId IN (:...songIds)', { songIds })
      .getRawMany<{ songId: string }>();
    return new Set(likes.map((l) => l.songId));
  }

  private async profilesOf(
    userIds: string[],
    comAvatar = false,
  ): Promise<Map<string, { handle: string; displayName: string; avatarKey?: string | null }>> {
    const unicos = [...new Set(userIds)];
    if (unicos.length === 0) return new Map();
    const profiles = await this.dataSource
      .getRepository(Profile)
      .createQueryBuilder('p')
      .where('p.userId IN (:...ids)', { ids: unicos })
      .getMany();
    return new Map(
      profiles.map((p) => [
        p.userId,
        {
          handle: p.handle,
          displayName: p.displayName,
          ...(comAvatar ? { avatarKey: p.avatarKey } : {}),
        },
      ]),
    );
  }
}
