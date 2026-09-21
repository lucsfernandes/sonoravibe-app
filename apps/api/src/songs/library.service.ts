import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Song, SongLike, Stem, Workspace } from '@sonora/db';
import {
  AUDIO_FORMAT_SPECS,
  PLANS,
  estimateDownloadMb,
  formatLabel,
  formatNote,
  type AudioFormat,
  type GenerationStatus,
  type MasterFormat,
} from '@sonora/shared';
import { StorageService } from '@sonora/storage';
import { DataSource, In } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { PlansService } from '../plans/plans.service';
import { STORAGE } from '../storage/storage.module';

export interface SongSummary {
  id: string;
  title: string;
  status: GenerationStatus;
  kind: string;
  durationMs: number;
  instrumental: boolean;
  stylePrompt: string | null;
  isPublic: boolean;
  playCount: number;
  likeCount: number;
  commentCount: number;
  workspaceId: string | null;
  audioUrl: string | null;
  coverUrl: string | null;
  createdAt: Date;
}

export interface SongDetail extends SongSummary {
  lyrics: string | null;
  excludeStyles: string | null;
  params: Record<string, unknown> | null;
  providerId: string | null;
  parentSongId: string | null;
  allowRemixes: boolean;
  allowComments: boolean;
  likedByMe: boolean;
  /**
   * Quem está pedindo é o dono da música.
   *
   * Sem este campo a interface não tem como distinguir "minha" de "de outra
   * pessoa" numa música pública, e acabava mostrando Publicar, Estender e
   * Separar stems na música dos outros — botões que só existem para devolver
   * 403 quando clicados.
   */
  isMine: boolean;
  stems: { kind: string; url: string }[];
  /** O que o usuário pode baixar, com aviso honesto sobre o que cada formato entrega. */
  downloads: {
    format: AudioFormat;
    label: string;
    note: string;
    estimatedMb: number;
    allowed: boolean;
  }[];
}

export interface ListOptions {
  workspaceId?: string;
  cursor?: string;
  limit: number;
  filter: 'all' | 'public' | 'private' | 'liked';
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Leitura e manutenção da biblioteca do usuário.
 *
 * A paginação é por cursor (createdAt + id) e não por offset: a biblioteca
 * cresce pelo topo, e com OFFSET o usuário veria itens repetidos ao rolar
 * enquanto uma geração nova termina.
 */
@Injectable()
export class LibraryService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STORAGE) private readonly storage: StorageService,
    private readonly plans: PlansService,
  ) {}

  async list(userId: string, options: ListOptions): Promise<Page<SongSummary>> {
    const qb = this.dataSource
      .getRepository(Song)
      .createQueryBuilder('song')
      .where('song.userId = :userId', { userId })
      .orderBy('song.createdAt', 'DESC')
      .addOrderBy('song.id', 'DESC')
      // Uma linha a mais que o pedido: é assim que sabemos se existe próxima
      // página sem fazer um COUNT na tabela inteira.
      .take(options.limit + 1);

    if (options.workspaceId) {
      qb.andWhere('song.workspaceId = :workspaceId', { workspaceId: options.workspaceId });
    }
    if (options.filter === 'public') qb.andWhere('song.isPublic = true');
    if (options.filter === 'private') qb.andWhere('song.isPublic = false');
    if (options.filter === 'liked') {
      qb.innerJoin(SongLike, 'like', 'like.songId = song.id AND like.userId = :userId', {
        userId,
      });
    }

    const cursor = decodeCursor(options.cursor);
    if (cursor) {
      qb.andWhere('(song.createdAt, song.id) < (:createdAt, :id)', cursor);
    }

    const rows = await qb.getMany();
    const items = rows.slice(0, options.limit);
    const last = items[items.length - 1];

    return {
      items: await Promise.all(items.map((song) => this.toSummary(song))),
      nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null,
    };
  }

  async findOne(userId: string | null, songId: string): Promise<SongDetail> {
    const song = await this.dataSource.getRepository(Song).findOneBy({ id: songId });
    if (!song) throw new NotFoundException('Música não encontrada.');

    // Música privada só aparece para o dono. Responder 404 (e não 403) evita
    // confirmar que o id existe para quem não deveria saber.
    if (!song.isPublic && song.userId !== userId) {
      throw new NotFoundException('Música não encontrada.');
    }

    const [stems, likedByMe] = await Promise.all([
      this.dataSource.getRepository(Stem).findBy({ songId }),
      userId
        ? this.dataSource
            .getRepository(SongLike)
            .existsBy({ songId, userId })
        : Promise.resolve(false),
    ]);

    const planCode = await this.plans.planCodeOf(song.userId);
    const plano = await this.plans.planOf(song.userId);
    const master = masterFormatOf(song.masterKey);

    return {
      ...(await this.toSummary(song)),
      lyrics: song.lyrics,
      excludeStyles: song.excludeStyles,
      params: song.params as Record<string, unknown> | null,
      providerId: song.providerId,
      parentSongId: song.parentSongId,
      allowRemixes: song.allowRemixes,
      allowComments: song.allowComments,
      likedByMe,
      isMine: userId !== null && song.userId === userId,
      stems: await Promise.all(
        stems.map(async (stem) => ({
          kind: stem.kind,
          url: await this.storage.presignGet(stem.storageKey),
        })),
      ),
      // `Promise.all` e não um map síncrono: `canDownload` passou a consultar o
      // plano carregado do banco, então cada formato é uma promessa.
      downloads: await Promise.all(
        (Object.keys(AUDIO_FORMAT_SPECS) as AudioFormat[]).map(async (format) => ({
          format,
          label: formatLabel(format, plano.features.mp3Quality),
          note: formatNote(format, master),
          estimatedMb: estimateDownloadMb(format, song.durationMs),
          allowed: await this.plans.canDownload(planCode, format),
        })),
      ),
    };
  }

  async update(
    userId: string,
    songId: string,
    patch: {
      title?: string;
      workspaceId?: string | null;
      allowRemixes?: boolean;
      allowComments?: boolean;
    },
  ): Promise<SongDetail> {
    const song = await this.own(userId, songId);

    if (patch.workspaceId !== undefined && patch.workspaceId !== null) {
      const owned = await this.dataSource
        .getRepository(Workspace)
        .existsBy({ id: patch.workspaceId, userId });
      if (!owned) throw new ForbiddenException('Workspace não encontrado na sua conta.');
    }

    await this.dataSource.getRepository(Song).update({ id: song.id }, {
      ...(patch.title !== undefined ? { title: patch.title.slice(0, 160) } : {}),
      ...(patch.workspaceId !== undefined ? { workspaceId: patch.workspaceId } : {}),
      ...(patch.allowRemixes !== undefined ? { allowRemixes: patch.allowRemixes } : {}),
      ...(patch.allowComments !== undefined ? { allowComments: patch.allowComments } : {}),
    });

    return this.findOne(userId, songId);
  }

  /**
   * Manda para a lixeira. Exclusão lógica: o arquivo no R2 só é apagado depois
   * de 30 dias, por CronJob — apagar na hora torna qualquer engano irreversível.
   */
  async remove(userId: string, songId: string): Promise<void> {
    const song = await this.own(userId, songId);
    await this.dataSource.getRepository(Song).softDelete({ id: song.id });
  }

  async publish(userId: string, songId: string, isPublic: boolean): Promise<SongDetail> {
    const song = await this.own(userId, songId);

    if (isPublic && song.status !== 'complete') {
      throw new ForbiddenException('Só dá para publicar uma música que terminou de gerar.');
    }

    await this.dataSource.getRepository(Song).update(
      { id: song.id },
      // publishedAt só é gravado na primeira publicação: republicar não deve
      // fazer a música voltar ao topo do Explore.
      { isPublic, ...(isPublic && !song.publishedAt ? { publishedAt: new Date() } : {}) },
    );

    return this.findOne(userId, songId);
  }

  /** Carrega garantindo que a música é do usuário. */
  async own(userId: string, songId: string): Promise<Song> {
    const song = await this.dataSource.getRepository(Song).findOneBy({ id: songId, userId });
    if (!song) throw new NotFoundException('Música não encontrada.');
    return song;
  }

  /** Verifica dono de várias de uma vez, para o download em lote. */
  async ownMany(userId: string, songIds: string[]): Promise<Song[]> {
    if (songIds.length === 0) return [];
    const songs = await this.dataSource
      .getRepository(Song)
      .findBy({ id: In(songIds), userId });

    if (songs.length !== songIds.length) {
      const encontrados = new Set(songs.map((s) => s.id));
      const faltando = songIds.filter((id) => !encontrados.has(id));
      throw new NotFoundException(`Músicas não encontradas na sua conta: ${faltando.join(', ')}`);
    }
    return songs;
  }

  private async toSummary(song: Song): Promise<SongSummary> {
    return {
      id: song.id,
      title: song.title,
      status: song.status,
      kind: song.kind,
      durationMs: song.durationMs,
      instrumental: song.instrumental,
      stylePrompt: song.stylePrompt,
      isPublic: song.isPublic,
      playCount: song.playCount,
      likeCount: song.likeCount,
      commentCount: song.commentCount,
      workspaceId: song.workspaceId,
      audioUrl: song.masterKey ? await this.storage.presignGet(song.masterKey) : null,
      coverUrl: song.coverKey ? await this.storage.presignGet(song.coverKey) : null,
      createdAt: song.createdAt,
    };
  }
}

/** O master é FLAC (ACE-Step) ou MP3 (Lyria); a extensão da chave diz qual. */
export function masterFormatOf(masterKey: string | null): MasterFormat {
  return masterKey?.endsWith('.mp3') ? 'mp3' : 'flac';
}

function encodeCursor(song: Song): string {
  return Buffer.from(`${song.createdAt.toISOString()}|${song.id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(createdAt ?? '');
  // Cursor corrompido (ou adulterado) volta para a primeira página em vez de
  // derrubar a listagem com erro 500.
  if (!id || Number.isNaN(date.getTime())) return null;
  return { createdAt: date, id };
}
