import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Generation, Song } from '@sonora/db';
import { STATUS_PROGRESS, isTerminal, type GenerationStatus } from '@sonora/shared';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { CreditsService } from '../credits/credits.service';
import { DATA_SOURCE } from '../database/database.module';
import { GENERATION_QUEUE } from '../queue/queue.module';
import { GenerationEventsService } from './generation-events.service';

export interface GenerationView {
  id: string;
  songId: string;
  status: GenerationStatus;
  progress: number;
  kind: string;
  providerId: string;
  creditsCharged: number;
  refunded: boolean;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

@Injectable()
export class GenerationsService {
  private readonly logger = new Logger(GenerationsService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(GENERATION_QUEUE) private readonly queue: Queue,
    private readonly credits: CreditsService,
    private readonly events: GenerationEventsService,
  ) {}

  async findOne(userId: string, generationId: string): Promise<GenerationView> {
    const generation = await this.dataSource.getRepository(Generation).findOne({
      // O userId entra no WHERE, não numa checagem depois: assim uma geração de
      // outra pessoa responde 404, sem revelar que o id existe.
      where: { id: generationId, userId },
    });
    if (!generation) throw new NotFoundException('Geração não encontrada.');

    return {
      id: generation.id,
      songId: generation.songId,
      status: generation.status,
      progress: STATUS_PROGRESS[generation.status],
      kind: generation.kind,
      providerId: generation.providerId,
      creditsCharged: generation.creditsCharged,
      refunded: generation.refunded,
      error: generation.errorMessage,
      createdAt: generation.createdAt,
      finishedAt: generation.finishedAt,
    };
  }

  /**
   * Cancela e estorna.
   *
   * Um job que ainda está na fila é removido e o estorno é imediato. Um job já
   * em execução não pode ser interrompido de fora: marcamos como cancelado e o
   * worker descarta o resultado ao terminar — o custo com o provedor já foi
   * pago, mas o usuário não fica com o crédito preso.
   */
  async cancel(userId: string, generationId: string): Promise<{ refunded: number }> {
    const generation = await this.dataSource
      .getRepository(Generation)
      .findOne({ where: { id: generationId, userId } });
    if (!generation) throw new NotFoundException('Geração não encontrada.');

    if (isTerminal(generation.status)) {
      throw new ConflictException(
        `Esta geração já terminou com status "${generation.status}".`,
      );
    }

    const job = await this.queue.getJob(generation.jobId ?? generation.id);
    const estadoDoJob = job ? await job.getState() : 'missing';

    if (job && estadoDoJob !== 'active') {
      await job.remove().catch((err: unknown) => {
        // Corrida com o worker pegando o job: seguimos com o cancelamento
        // lógico, que é o que protege o crédito.
        this.logger.warn(`Não removi o job ${job.id}: ${(err as Error).message}`);
      });
    }

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(Generation).update(
        { id: generationId },
        { status: 'canceled', finishedAt: new Date() },
      );
      await em.getRepository(Song).update({ id: generation.songId }, { status: 'canceled' });
    });

    const { refunded } = await this.credits.refund(generationId);

    await this.events.publish({
      userId,
      generationId,
      songId: generation.songId,
      status: 'canceled',
      progress: STATUS_PROGRESS.canceled,
    });

    this.logger.log(
      `Geração ${generationId} cancelada (job ${estadoDoJob}); ${refunded} créditos estornados`,
    );
    return { refunded };
  }
}
