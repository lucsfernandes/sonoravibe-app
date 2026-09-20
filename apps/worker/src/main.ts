import 'reflect-metadata';
import { resolve } from 'node:path';
import { CreditsLedger, ENTITIES } from '@sonora/db';
import { QUEUES, type GenerationJob } from '@sonora/shared';
import { StorageService } from '@sonora/storage';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { DataSource } from 'typeorm';
import { loadWorkerConfig } from './config';
import { GenerationProcessor } from './generation/generation.processor';
import { buildMusicRouter } from './providers/factory';

try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // Sem .env: seguimos com o ambiente do processo (é o caso no k3s).
}

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig();

  const dataSource = new DataSource({
    type: 'postgres',
    url: config.DATABASE_URL,
    entities: ENTITIES,
    // O worker nunca cria schema: quem faz isso é a API (dev) ou a migration
    // no deploy. Dois processos sincronizando a mesma base disputam DDL.
    synchronize: false,
    logging: ['error'],
    poolSize: 5,
  });
  await dataSource.initialize();

  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

  const storage = new StorageService({
    accountId: config.R2_ACCOUNT_ID,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    bucket: config.R2_BUCKET,
    publicUrl: config.R2_PUBLIC_URL,
    endpoint: config.R2_ENDPOINT,
  });

  const router = buildMusicRouter(config, (event) => {
    // Cair para a reserva multiplica o custo por ~10. Vira log de aviso hoje e
    // alerta quando a taxa passar de 10% das gerações.
    console.warn(
      `[custo] ${event.from} -> ${event.to} em ${event.kind}: ${event.reason}`,
    );
  });

  const processor = new GenerationProcessor({
    dataSource,
    storage,
    redis: connection,
    router,
    credits: new CreditsLedger(dataSource),
  });

  const worker = new Worker<GenerationJob>(
    QUEUES.generation,
    async (job: Job<GenerationJob>) => processor.process(job.data),
    {
      connection,
      concurrency: config.WORKER_CONCURRENCY,
      // Uma geração pode levar minutos; sem estender o lock, o BullMQ acha que
      // o worker morreu e entrega o mesmo job a outra réplica.
      lockDuration: 15 * 60_000,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[fila] job ${job?.id} falhou: ${err.message}`);
  });

  console.log(
    `Worker no ar | fila '${QUEUES.generation}' | concorrência ${config.WORKER_CONCURRENCY} | motor '${config.MUSIC_PROVIDER}'`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n${signal} recebido, terminando os jobs em andamento...`);
    // close() espera os jobs ativos, em vez de largá-los no meio: um job
    // interrompido voltaria para a fila e o usuário pagaria a geração duas vezes.
    await worker.close();
    await connection.quit().catch(() => undefined);
    await dataSource.destroy().catch(() => undefined);
    process.exitCode = 0;
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error(`\nO worker não subiu:\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
