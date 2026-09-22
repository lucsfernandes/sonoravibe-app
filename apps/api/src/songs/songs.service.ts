import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Generation, Playlist, PlaylistSong, Song, Workspace } from '@sonora/db';
import {
  CREDIT_COSTS,
  DEFAULT_JOB_OPTIONS,
  MAX_DURATION_SECONDS,
  maxDurationFor,
  type AdvancedControls,
  type GenerationJob,
  type GenerationKind,
  type GenerationRequest,
  type PlanCode,
  type PlaylistInspiration,
} from '@sonora/shared';
import { Queue } from 'bullmq';
import { DataSource, In } from 'typeorm';
import { CreditsService, InsufficientCreditsError } from '../credits/credits.service';
import { CONFIG, type AppConfig } from '../config/env';
import { DATA_SOURCE } from '../database/database.module';
import { PlansService } from '../plans/plans.service';
import { GENERATION_QUEUE } from '../queue/queue.module';
import type { SessionUser } from '../auth/session.guard';

export interface GenerateResult {
  songId: string;
  generationId: string;
  creditsCharged: number;
  status: 'queued';
}

/**
 * Enfileiramento de uma geração.
 *
 * A ordem aqui é deliberada: valida o plano, grava Song e Generation, reserva
 * os créditos e só então enfileira. Reservar antes de enfileirar é o que impede
 * alguém com saldo para uma música disparar dez de uma vez — a fila aceitaria
 * todas e a cobrança só apareceria no fim.
 *
 * Se a reserva falhar, a geração já gravada é marcada como falha em vez de
 * apagada: o usuário vê no histórico por que não rodou.
 */
@Injectable()
export class SongsService {
  private readonly logger = new Logger(SongsService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(GENERATION_QUEUE) private readonly queue: Queue,
    private readonly credits: CreditsService,
    private readonly plans: PlansService,
    // O motor configurado decide o teto de duração que o plano pode prometer.
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async generate(user: SessionUser, request: GenerationRequest): Promise<GenerateResult> {
    const plan = await this.plans.planOf(user.id);

    // "+ Áudio": a faixa de referência transforma o pedido num remix, que é o
    // tipo que os motores tratam como áudio-para-áudio. Custa o mesmo que uma
    // música; só muda o caminho no worker.
    const source =
      request.mode !== 'sounds' && request.sourceSongId
        ? await this.resolveSource(user.id, request.sourceSongId)
        : null;
    const inspiration =
      request.mode !== 'sounds' && request.inspirationPlaylistId
        ? await this.resolveInspiration(user.id, request.inspirationPlaylistId)
        : null;

    const kind: GenerationKind = request.mode === 'sounds' ? 'clip' : source ? 'remix' : 'song';
    const cost =
      kind === 'clip' ? CREDIT_COSTS.clip : kind === 'remix' ? CREDIT_COSTS.remix : CREDIT_COSTS.song;

    const controls = request.mode === 'advanced' ? request.controls : undefined;
    this.assertPlanAllows(plan.code, plan.features, controls);

    const workspaceId = await this.resolveWorkspace(user.id, request.workspaceId);

    const { song, generation } = await this.dataSource.transaction(async (em) => {
      const song = await em.getRepository(Song).save(
        em.getRepository(Song).create({
          userId: user.id,
          workspaceId,
          parentSongId: source?.id ?? null,
          title: this.provisionalTitle(request),
          stylePrompt: this.stylePromptOf(request),
          excludeStyles: controls?.excludeStyles ?? null,
          lyrics: request.mode === 'advanced' ? (request.lyrics ?? null) : null,
          instrumental: request.mode === 'sounds' ? true : request.instrumental,
          status: 'queued',
          kind,
          params: this.paramsOf(request, inspiration),
        }),
      );

      const generation = await em.getRepository(Generation).save(
        em.getRepository(Generation).create({
          songId: song.id,
          userId: user.id,
          kind,
          status: 'queued',
          // Quem realmente atendeu é gravado pelo worker: o roteador pode cair
          // no motor reserva, e é isso que precisa aparecer no suporte.
          providerId: 'pending',
          creditsCharged: cost,
        }),
      );

      return { song, generation };
    });

    try {
      await this.credits.reserve(user.id, cost, generation.id);
    } catch (err) {
      await this.markFailed(song.id, generation.id, err);
      if (err instanceof InsufficientCreditsError) throw insufficientCredits(err);
      throw err;
    }

    const job: GenerationJob = {
      generationId: generation.id,
      songId: song.id,
      userId: user.id,
      kind,
      reservedCredits: cost,
      ...(source ? { sourceSongId: source.id } : {}),
      // Quem nomeou a música não quer que o modelo a renomeie no fim.
      titleFromUser: request.mode === 'advanced' && Boolean(request.title),
    };

    const enqueued = await this.queue.add('generate', job, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: generation.id,
      priority: plan.features.queuePriority,
    });

    await this.dataSource
      .getRepository(Generation)
      .update({ id: generation.id }, { jobId: enqueued.id ?? generation.id });

    this.logger.log(
      `Geração ${generation.id} na fila | usuário ${user.id} | plano ${plan.code} | ${cost} créditos`,
    );

    return { songId: song.id, generationId: generation.id, creditsCharged: cost, status: 'queued' };
  }

  /**
   * Limites do plano. Ficam aqui, e não no schema do Zod, porque dependem de
   * quem está pedindo — o mesmo corpo de requisição é válido para um assinante
   * e inválido para quem está no Free.
   */
  private assertPlanAllows(
    code: PlanCode,
    features: { maxMode: boolean },
    controls: AdvancedControls | undefined,
  ): void {
    if (!controls) return;

    if (controls.maxMode && !features.maxMode) {
      throw new ForbiddenException(
        'Max Mode é exclusivo do plano Premier. Desligue-o ou faça upgrade.',
      );
    }

    // `maxDurationFor` e não `features.maxDurationSeconds`: o limite que vale é
    // o menor entre o do plano e o do motor ligado. É o mesmo número que a tela
    // de planos publica, então a recusa aqui nunca contradiz o que foi vendido.
    const limite = maxDurationFor(code, this.config.MUSIC_PROVIDER);
    const requested = controls.durationSeconds;
    if (requested && requested > limite) {
      throw new ForbiddenException(
        `Seu plano gera músicas de até ${limite}s (pediu ${requested}s). ` +
          `O teto técnico é ${MAX_DURATION_SECONDS}s.`,
      );
    }
  }

  /** Garante que o workspace é do próprio usuário; sem isso, cai no padrão. */
  private async resolveWorkspace(userId: string, requested?: string): Promise<string | null> {
    const repo = this.dataSource.getRepository(Workspace);

    if (requested) {
      const owned = await repo.findOne({
        where: { id: requested, userId },
        select: { id: true },
      });
      if (!owned) {
        throw new ForbiddenException('Workspace não encontrado na sua conta.');
      }
      return owned.id;
    }

    const fallback = await repo.findOne({
      where: { userId, isDefault: true },
      select: { id: true },
    });
    return fallback?.id ?? null;
  }

  /**
   * A faixa de referência do "+ Áudio".
   *
   * Vale a própria música ou uma pública cujo autor liberou remixes: é a mesma
   * regra do botão Remix na página da música, e é ela que impede alguém de
   * usar como base uma faixa que o autor quis manter fechada. Responde 404
   * (e não 403) para não confirmar que o id existe.
   */
  private async resolveSource(userId: string, songId: string): Promise<Song> {
    const song = await this.dataSource.getRepository(Song).findOneBy({ id: songId });
    const permitida = song && (song.userId === userId || (song.isPublic && song.allowRemixes));
    if (!song || !permitida) throw new NotFoundException('Faixa de referência não encontrada.');
    if (song.status !== 'complete' || !song.masterKey) {
      throw new ForbiddenException('A faixa de referência ainda não terminou de processar.');
    }
    return song;
  }

  /**
   * A inspiração do "+ Inspiração": os estilos das faixas de uma playlist.
   *
   * Resolvida agora, e não no worker, porque a playlist pode mudar entre o
   * clique e a fila. Poucos estilos, encurtados: o caption do ACE-Step tem
   * 512 caracteres, e a inspiração não pode engolir o que o usuário escreveu.
   */
  private async resolveInspiration(
    userId: string,
    playlistId: string,
  ): Promise<PlaylistInspiration> {
    const playlist = await this.dataSource
      .getRepository(Playlist)
      .findOneBy({ id: playlistId, userId });
    if (!playlist) throw new NotFoundException('Playlist de inspiração não encontrada.');

    const entradas = await this.dataSource.getRepository(PlaylistSong).find({
      where: { playlistId },
      order: { position: 'ASC' },
      take: 30,
    });
    const songs = entradas.length
      ? await this.dataSource
          .getRepository(Song)
          .find({ where: { id: In(entradas.map((e) => e.songId)) }, select: { id: true, stylePrompt: true } })
      : [];

    const vistos = new Set<string>();
    const styles: string[] = [];
    for (const song of songs) {
      const estilo = song.stylePrompt?.split('\n')[0]?.trim().slice(0, 60);
      if (!estilo) continue;
      const chave = estilo.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      styles.push(estilo);
      if (styles.length >= 5) break;
    }

    return { playlistId: playlist.id, name: playlist.name, styles };
  }

  private async markFailed(songId: string, generationId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.dataSource.transaction(async (em) => {
      await em.getRepository(Generation).update(
        { id: generationId },
        { status: 'failed', errorMessage: message, finishedAt: new Date() },
      );
      await em.getRepository(Song).update({ id: songId }, { status: 'failed' });
    });
  }

  /**
   * Título provisório, trocado pelo definitivo quando a geração termina (o
   * modelo devolve um título, ou usamos a primeira linha da letra). Existe
   * porque a música aparece na biblioteca assim que entra na fila.
   */
  private provisionalTitle(request: GenerationRequest): string {
    if (request.mode === 'advanced' && request.title) return request.title.slice(0, 160);
    const source =
      request.mode === 'advanced'
        ? (request.controls.styles ?? request.lyricsBrief ?? 'Nova música')
        : request.prompt;
    return source.split('\n')[0].trim().slice(0, 160) || 'Nova música';
  }

  private stylePromptOf(request: GenerationRequest): string | null {
    if (request.mode === 'advanced') return request.controls.styles ?? null;
    return request.prompt;
  }

  /**
   * O que fica gravado em `params`. Além dos controles, leva a inspiração da
   * playlist: o worker lê daqui para montar o prompt. O tipo da coluna é
   * `Partial<AdvancedControls>`, e a inspiração entra como campo extra.
   */
  private paramsOf(
    request: GenerationRequest,
    inspiration: PlaylistInspiration | null,
  ): Partial<AdvancedControls> | null {
    const extra = inspiration ? { inspiration } : {};
    if (request.mode === 'advanced') return { ...request.controls, ...extra };
    if (request.mode === 'sounds') {
      return { bpm: request.bpm, key: request.key };
    }
    return inspiration ? (extra as Partial<AdvancedControls>) : null;
  }
}

/**
 * 402 para saldo insuficiente.
 *
 * O Nest não traz uma exceção pronta para este status, e a semântica é
 * exatamente esta ("faltou saldo"), então vale montar na mão. Fica aqui, e não
 * duplicada, porque geração e edições derivadas cobram do mesmo jeito.
 */
export function insufficientCredits(err: InsufficientCreditsError): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.PAYMENT_REQUIRED,
      message: err.message,
      required: err.required,
      available: err.available,
    },
    HttpStatus.PAYMENT_REQUIRED,
  );
}
