import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Profile, Song, SongLike, Stem, Workspace } from '@sonora/db';
import {
  AUDIO_FORMAT_SPECS,
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
  PLANS,
  estimateDownloadMb,
  formatLabel,
  formatNote,
  jobId,
  type AudioFormat,
  type GenerationStatus,
  type MasterFormat,
  type WaveformJob,
} from '@sonora/shared';
import { StorageService } from '@sonora/storage';
import { Queue } from 'bullmq';
import { DataSource, In, type SelectQueryBuilder } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { PlansService } from '../plans/plans.service';
import { TRANSCODE_QUEUE } from '../queue/queue.module';
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
  parentSongId: string | null;
  audioUrl: string | null;
  coverUrl: string | null;
  /** Forma de onda (0–1). Null até o worker calcular. */
  waveform: number[] | null;
  /** Curtida por quem pediu a lista. Só a biblioteca preenche; é `false` fora dela. */
  likedByMe: boolean;
  createdAt: Date;
}

export const LIST_SORTS = ['newest', 'oldest', 'plays', 'likes', 'title', 'duration'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const LIST_FILTERS = ['all', 'public', 'private', 'liked', 'uploads'] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export const LIST_KINDS = ['all', 'song', 'clip', 'upload', 'derived'] as const;
export const LIST_VOCALS = ['all', 'vocal', 'instrumental'] as const;
export const LIST_STATUSES = ['all', 'ready', 'generating', 'failed'] as const;

/** Tipos que nascem de outra faixa. */
const DERIVED_KINDS = ['extend', 'remix', 'cover', 'replace_section', 'remaster', 'edit'];

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
  /**
   * Quem fez a música. A página pública mostra nome e foto ao lado do título,
   * e sem isto ela precisaria de uma segunda chamada ao perfil só para isso.
   */
  author: { handle: string; displayName: string; avatarUrl: string | null };
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
  /** Página numerada (1 em diante). Quando presente, o cursor é ignorado. */
  page?: number;
  limit: number;
  filter: ListFilter;
  /** Busca em título, estilo e letra. */
  q?: string;
  sort: ListSort;
  kind: (typeof LIST_KINDS)[number];
  vocals: (typeof LIST_VOCALS)[number];
  status: (typeof LIST_STATUSES)[number];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /** Quantas faixas casam com os filtros, em todas as páginas. */
  total: number;
  /** Página atual e quantas existem, na paginação numerada. */
  page: number;
  pageCount: number;
}

/**
 * Leitura e manutenção da biblioteca do usuário.
 *
 * Dois jeitos de paginar, para dois usos:
 *
 *  - Por cursor (createdAt + id), no "carregar mais" da biblioteca. A lista
 *    cresce pelo topo, e com OFFSET o usuário veria itens repetidos ao rolar
 *    enquanto uma geração nova termina. Só vale na ordem cronológica.
 *  - Por página numerada, na aba Criar: ali a pessoa pula de página, ordena
 *    por reproduções ou por título, e o cursor não tem como expressar isso.
 */
@Injectable()
export class LibraryService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STORAGE) private readonly storage: StorageService,
    private readonly plans: PlansService,
    @Inject(TRANSCODE_QUEUE) private readonly transcodeQueue: Queue,
  ) {}

  async list(userId: string, options: ListOptions): Promise<Page<SongSummary>> {
    const qb = this.dataSource
      .getRepository(Song)
      .createQueryBuilder('song')
      .where('song.userId = :userId', { userId });

    if (options.workspaceId) {
      qb.andWhere('song.workspaceId = :workspaceId', { workspaceId: options.workspaceId });
    }
    if (options.filter === 'public') qb.andWhere('song.isPublic = true');
    if (options.filter === 'private') qb.andWhere('song.isPublic = false');
    if (options.filter === 'uploads') qb.andWhere("song.kind = 'upload'");
    if (options.filter === 'liked') {
      qb.innerJoin(SongLike, 'like', 'like.songId = song.id AND like.userId = :userId', {
        userId,
      });
    }

    if (options.kind === 'derived') {
      qb.andWhere('song.kind IN (:...derived)', { derived: DERIVED_KINDS });
    } else if (options.kind !== 'all') {
      qb.andWhere('song.kind = :kind', { kind: options.kind });
    }

    if (options.vocals === 'instrumental') qb.andWhere('song.instrumental = true');
    if (options.vocals === 'vocal') qb.andWhere('song.instrumental = false');

    if (options.status === 'ready') qb.andWhere("song.status = 'complete'");
    if (options.status === 'failed') qb.andWhere("song.status IN ('failed', 'canceled')");
    if (options.status === 'generating') {
      qb.andWhere("song.status NOT IN ('complete', 'failed', 'canceled')");
    }

    const termo = options.q?.trim();
    if (termo) {
      // ILIKE com o termo escapado: um `%` digitado pelo usuário viraria
      // coringa e "100%" casaria com tudo.
      qb.andWhere(
        '(song.title ILIKE :q OR song.stylePrompt ILIKE :q OR song.lyrics ILIKE :q)',
        { q: `%${termo.replace(/[\\%_]/g, '\\$&')}%` },
      );
    }

    applySort(qb, options.sort);

    // Paginação numerada: a aba Criar pede página e ordem.
    if (options.page !== undefined || options.sort !== 'newest') {
      const page = Math.max(1, options.page ?? 1);
      const total = await qb.getCount();
      const pageCount = Math.max(1, Math.ceil(total / options.limit));
      const rows = await qb
        .skip((page - 1) * options.limit)
        .take(options.limit)
        .getMany();
      return {
        items: await this.toSummaries(userId, rows),
        nextCursor: null,
        total,
        page,
        pageCount,
      };
    }

    // Paginação por cursor: o "carregar mais" da biblioteca.
    const total = await qb.getCount();
    const cursor = decodeCursor(options.cursor);
    if (cursor) {
      qb.andWhere('(song.createdAt, song.id) < (:createdAt, :id)', cursor);
    }
    // Uma linha a mais que o pedido: é assim que sabemos se existe próxima
    // página sem contar de novo.
    const rows = await qb.take(options.limit + 1).getMany();
    const items = rows.slice(0, options.limit);
    const last = items[items.length - 1];

    return {
      items: await this.toSummaries(userId, items),
      nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null,
      total,
      page: 1,
      pageCount: Math.max(1, Math.ceil(total / options.limit)),
    };
  }

  /**
   * Pede ao worker a forma de onda de uma faixa que ainda não tem.
   *
   * Faixas de antes da coluna `waveform` não têm onda calculada; a interface
   * chama isto ao desenhá-las no modo onda. O id do job deduplica: cem
   * pessoas olhando a mesma faixa enfileiram um cálculo só.
   */
  async requestWaveform(userId: string, songId: string): Promise<{ queued: boolean }> {
    const song = await this.own(userId, songId);
    if (song.waveform || !song.masterKey || song.status !== 'complete') {
      return { queued: false };
    }
    const job: WaveformJob = { songId };
    await this.transcodeQueue.add(JOB_NAMES.waveform, job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: jobId(songId, 'waveform'),
      // Se o cálculo falhar, nada de esperar dez segundos por um desenho.
      attempts: 1,
    });
    return { queued: true };
  }

  /** Resumo de várias faixas, com as curtidas do usuário resolvidas numa consulta só. */
  private async toSummaries(userId: string, songs: Song[]): Promise<SongSummary[]> {
    if (songs.length === 0) return [];
    const curtidas = await this.dataSource
      .getRepository(SongLike)
      .createQueryBuilder('like')
      .select('like.songId', 'songId')
      .where('like.userId = :userId', { userId })
      .andWhere('like.songId IN (:...ids)', { ids: songs.map((s) => s.id) })
      .getRawMany<{ songId: string }>();
    const marcadas = new Set(curtidas.map((c) => c.songId));
    return Promise.all(songs.map((song) => this.toSummary(song, marcadas.has(song.id))));
  }

  async findOne(userId: string | null, songId: string): Promise<SongDetail> {
    const song = await this.dataSource.getRepository(Song).findOneBy({ id: songId });
    if (!song) throw new NotFoundException('Música não encontrada.');

    // Música privada só aparece para o dono. Responder 404 (e não 403) evita
    // confirmar que o id existe para quem não deveria saber.
    if (!song.isPublic && song.userId !== userId) {
      throw new NotFoundException('Música não encontrada.');
    }

    const [stems, likedByMe, autor] = await Promise.all([
      this.dataSource.getRepository(Stem).findBy({ songId }),
      userId
        ? this.dataSource
            .getRepository(SongLike)
            .existsBy({ songId, userId })
        : Promise.resolve(false),
      this.dataSource.getRepository(Profile).findOneBy({ userId: song.userId }),
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
      author: {
        handle: autor?.handle ?? 'desconhecido',
        displayName: autor?.displayName ?? 'Usuário',
        avatarUrl: autor?.avatarKey ? await this.storage.presignGet(autor.avatarKey) : null,
      },
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
      /**
       * Letra e estilo EXIBIDOS. Editá-los não regera nada: a música já
       * existe, e o que muda é o texto que a página mostra ao lado dela.
       * Vazio vira null, para a página não desenhar um bloco em branco.
       */
      lyrics?: string | null;
      stylePrompt?: string | null;
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
      ...(patch.lyrics !== undefined ? { lyrics: patch.lyrics?.trim() || null } : {}),
      ...(patch.stylePrompt !== undefined ? { stylePrompt: patch.stylePrompt?.trim() || null } : {}),
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

  async toSummary(song: Song, likedByMe = false): Promise<SongSummary> {
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
      parentSongId: song.parentSongId,
      audioUrl: song.masterKey ? await this.storage.presignGet(song.masterKey) : null,
      coverUrl: song.coverKey ? await this.storage.presignGet(song.coverKey) : null,
      waveform: song.waveform,
      likedByMe,
      createdAt: song.createdAt,
    };
  }
}

/**
 * Ordem da lista. Toda ordem termina em (createdAt, id) para ser estável:
 * duas faixas com o mesmo número de reproduções não trocam de lugar entre
 * uma página e outra.
 */
function applySort(qb: SelectQueryBuilder<Song>, sort: ListSort): void {
  switch (sort) {
    case 'oldest':
      qb.orderBy('song.createdAt', 'ASC').addOrderBy('song.id', 'ASC');
      return;
    case 'plays':
      qb.orderBy('song.playCount', 'DESC');
      break;
    case 'likes':
      qb.orderBy('song.likeCount', 'DESC');
      break;
    case 'title':
      qb.orderBy('LOWER(song.title)', 'ASC');
      break;
    case 'duration':
      qb.orderBy('song.durationMs', 'DESC');
      break;
    default:
      qb.orderBy('song.createdAt', 'DESC').addOrderBy('song.id', 'DESC');
      return;
  }
  qb.addOrderBy('song.createdAt', 'DESC').addOrderBy('song.id', 'DESC');
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
