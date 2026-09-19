import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { QUEUES } from '@sonora/shared';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { CONFIG, type AppConfig } from '../config/env';

export const REDIS = Symbol('sonora.redis');
export const GENERATION_QUEUE = Symbol('sonora.queue.generation');
export const TRANSCODE_QUEUE = Symbol('sonora.queue.transcode');
export const STEMS_QUEUE = Symbol('sonora.queue.stems');

/**
 * Redis e produtores do BullMQ.
 *
 * `maxRetriesPerRequest: null` é exigência do BullMQ: com o padrão do ioredis,
 * comandos bloqueantes de fila falham durante uma reconexão.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [CONFIG],
      useFactory: (config: AppConfig) =>
        new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null }),
    },
    ...[
      [GENERATION_QUEUE, QUEUES.generation],
      [TRANSCODE_QUEUE, QUEUES.transcode],
      [STEMS_QUEUE, QUEUES.stems],
    ].map(([token, name]) => ({
      provide: token as symbol,
      inject: [REDIS],
      useFactory: (connection: Redis) => new Queue(name as string, { connection }),
    })),
  ],
  exports: [REDIS, GENERATION_QUEUE, TRANSCODE_QUEUE, STEMS_QUEUE],
})
export class QueueModule implements OnModuleDestroy {
  constructor() {}

  async onModuleDestroy(): Promise<void> {
    // As conexões são fechadas junto com o processo; nada a desmontar aqui.
  }
}
