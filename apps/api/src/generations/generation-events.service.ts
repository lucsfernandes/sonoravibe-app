import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PROGRESS_CHANNEL, type GenerationProgressMessage } from '@sonora/shared';
import type { Redis } from 'ioredis';
import { Observable, Subject, filter, interval, map, merge } from 'rxjs';
import { REDIS } from '../queue/queue.module';

/**
 * Ponte entre o worker e as conexões SSE abertas.
 *
 * Uma única assinatura no Redis atende todos os navegadores conectados nesta
 * réplica: o canal é global e o `userId` de cada mensagem decide quem recebe.
 * Assinar um canal por usuário multiplicaria as conexões do Redis pelo número
 * de pessoas online, sem ganho nenhum.
 *
 * A conexão de assinatura é obrigatoriamente separada: um cliente Redis em modo
 * subscribe recusa qualquer outro comando, e o mesmo cliente é usado pelas
 * filas do BullMQ.
 */
@Injectable()
export class GenerationEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationEventsService.name);
  private readonly events = new Subject<GenerationProgressMessage>();
  private subscriber?: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(PROGRESS_CHANNEL);

    this.subscriber.on('message', (_channel, payload) => {
      try {
        this.events.next(JSON.parse(payload) as GenerationProgressMessage);
      } catch (err) {
        // Mensagem malformada não pode derrubar o canal de todo mundo.
        this.logger.warn(`Evento de progresso ilegível: ${(err as Error).message}`);
      }
    });

    this.logger.log(`Assinando ${PROGRESS_CHANNEL}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.events.complete();
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Publica um evento. Usado pela própria API (cancelamento, por exemplo). */
  async publish(message: GenerationProgressMessage): Promise<void> {
    await this.redis.publish(PROGRESS_CHANNEL, JSON.stringify(message));
  }

  /**
   * Fluxo de eventos de um usuário, no formato que o `@Sse()` do Nest espera.
   *
   * O ping periódico não é decoração: proxies e o Traefik fecham conexão ociosa,
   * e sem tráfego o navegador só descobriria a queda na próxima geração.
   */
  streamFor(userId: string): Observable<{ type: string; data: unknown }> {
    const progress = this.events.pipe(
      filter((message) => message.userId === userId),
      // O userId sai do payload: ele serviu para rotear, e o cliente já sabe
      // quem é — mandá-lo de volta só engorda cada evento.
      map(({ userId: _roteamento, ...event }) => ({ type: 'progress', data: event })),
    );

    const heartbeat = interval(25_000).pipe(
      map(() => ({ type: 'ping', data: { at: new Date().toISOString() } })),
    );

    return merge(progress, heartbeat);
  }
}
