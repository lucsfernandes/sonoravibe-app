import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CreditsLedger, ENTITIES } from '@sonora/db';
import {
  JOB_NAMES,
  QUEUES,
  type EditJob,
  type GenerationJob,
  type ImportJob,
  type StemsJob,
  type TranscodeJob,
  type WaveformJob,
} from '@sonora/shared';
import { StorageService } from '@sonora/storage';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { DataSource } from 'typeorm';
import { loadWorkerConfig } from './config';
import { CoverArtGenerator } from './generation/cover-art';
import { CoverArtChain, FluxCoverGenerator, openRouterSceneWriter } from './generation/flux-cover';
import { GenerationProcessor } from './generation/generation.processor';
import { buildMusicRouter } from './providers/factory';
import { EditProcessor } from './edit/edit.processor';
import { ImportProcessor } from './import/import.processor';
import { StemsProcessor } from './stems/stems.processor';
import { TranscodeProcessor } from './transcode/transcode.processor';
import { WaveformProcessor } from './waveform/waveform.processor';

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

  const transcodeQueue = new Queue(QUEUES.transcode, { connection });

  const processor = new GenerationProcessor({
    dataSource,
    storage,
    redis: connection,
    router,
    credits: new CreditsLedger(dataSource),
    transcodeQueue,
    ffmpegPath: config.FFMPEG_PATH,
    // Capa: FLUX.2 [klein] no nosso endpoint da RunPod; se ele falhar ou demorar,
    // o modelo de imagem do OpenRouter desenha (decisão de 2026-09-24).
    coverArt: new CoverArtChain(
      [
        {
          name: 'FLUX.2 klein (RunPod)',
          source: new FluxCoverGenerator({
            baseUrl:
              config.RUNPOD_IMAGE_BASE_URL ??
              (config.RUNPOD_ENDPOINT_ID_IMAGE
                ? `https://api.runpod.ai/v2/${config.RUNPOD_ENDPOINT_ID_IMAGE}`
                : undefined),
            apiKey: config.RUNPOD_API_KEY,
            statusMethod: config.RUNPOD_IMAGE_BASE_URL ? 'POST' : 'GET',
            // A letra vira uma cena antes de chegar ao FLUX, que escreveria os versos na capa.
            sceneWriter: openRouterSceneWriter({
              apiKey: config.OPENROUTER_API_KEY,
              baseUrl: config.OPENROUTER_BASE_URL,
              model: config.OPENROUTER_TEXT_MODEL,
              siteUrl: config.OPENROUTER_SITE_URL,
              appName: config.OPENROUTER_APP_NAME,
            }),
          }),
        },
        {
          name: 'OpenRouter',
          source: new CoverArtGenerator({
            apiKey: config.OPENROUTER_API_KEY,
            baseUrl: config.OPENROUTER_BASE_URL,
            model: config.OPENROUTER_IMAGE_MODEL,
            siteUrl: config.OPENROUTER_SITE_URL,
            appName: config.OPENROUTER_APP_NAME,
          }),
        },
      ],
      (msg) => console.warn(msg),
    ),
  });

  const transcoder = new TranscodeProcessor({
    dataSource,
    storage,
    ffmpegPath: config.FFMPEG_PATH,
  });

  const editor = new EditProcessor({
    dataSource,
    storage,
    redis: connection,
    ffmpegPath: config.FFMPEG_PATH,
  });

  const importer = new ImportProcessor({
    dataSource,
    storage,
    redis: connection,
    ffmpegPath: config.FFMPEG_PATH,
  });

  const waveformer = new WaveformProcessor({
    dataSource,
    storage,
    ffmpegPath: config.FFMPEG_PATH,
  });

  const stemmer = new StemsProcessor({
    dataSource,
    storage,
    redis: connection,
    demucsPath: config.DEMUCS_PATH,
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

  // Fila separada da geração: converter não pode ficar atrás de uma música de
  // 8 minutos na fila, e a concorrência é maior porque o trabalho é curto.
  // A forma de onda divide esta fila: é o mesmo tipo de trabalho (baixar o
  // master, rodar o FFmpeg), distinguido pelo nome do job.
  const transcodeWorker = new Worker<TranscodeJob | WaveformJob>(
    QUEUES.transcode,
    async (job: Job<TranscodeJob | WaveformJob>) =>
      job.name === JOB_NAMES.waveform
        ? waveformer.process(job.data as WaveformJob)
        : transcoder.process(job.data as TranscodeJob),
    { connection, concurrency: config.WORKER_CONCURRENCY * 2, lockDuration: 5 * 60_000 },
  );

  // A importação de uploads também é FFmpeg sem motor, e mora na fila de edição.
  const editWorker = new Worker<EditJob | ImportJob>(
    QUEUES.edit,
    async (job: Job<EditJob | ImportJob>) =>
      job.name === JOB_NAMES.import
        ? importer.process(job.data as ImportJob)
        : editor.process(job.data as EditJob),
    { connection, concurrency: config.WORKER_CONCURRENCY, lockDuration: 5 * 60_000 },
  );

  // Concorrência 1: o Demucs come CPU e memória, e duas separações ao mesmo
  // tempo num nó pequeno derrubam o pod por falta de memória.
  const stemsWorker = new Worker<StemsJob>(
    QUEUES.stems,
    async (job: Job<StemsJob>) => stemmer.process(job.data),
    { connection, concurrency: 1, lockDuration: 30 * 60_000 },
  );

  for (const [nome, w] of [
    ['geração', worker],
    ['conversão', transcodeWorker],
    ['edição', editWorker],
    ['stems', stemsWorker],
  ] as const) {
    w.on('failed', (job, err) => {
      console.error(`[${nome}] job ${job?.id} falhou: ${err.message}`);
    });
  }

  console.log(
    `Worker no ar | filas ${Object.values(QUEUES).filter((q) => q !== 'maintenance').join(', ')} | ` +
      `concorrência ${config.WORKER_CONCURRENCY} | motor '${config.MUSIC_PROVIDER}'`,
  );

  // Sinal de vida para o liveness probe do Kubernetes.
  //
  // O worker não atende HTTP, então um probe HTTP falharia sempre e reiniciaria
  // o pod em laço. Em vez disso o probe olha a idade deste arquivo: se o laço
  // de eventos travar, o arquivo para de ser tocado e o pod é reiniciado.
  // O intervalo (30s) precisa ser bem menor que o limite do probe (180s), para
  // uma pausa de GC ou um pico de I/O não derrubar um worker saudável.
  const heartbeatPath = process.env.HEARTBEAT_PATH ?? '/tmp/heartbeat';
  const bater = () =>
    void writeFile(heartbeatPath, new Date().toISOString()).catch(() => undefined);
  bater();
  const heartbeat = setInterval(bater, 30_000);
  heartbeat.unref();

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(heartbeat);
    console.log(`\n${signal} recebido, terminando os jobs em andamento...`);
    // close() espera os jobs ativos, em vez de largá-los no meio: um job
    // interrompido voltaria para a fila e o usuário pagaria a geração duas vezes.
    await Promise.all([
      worker.close(),
      transcodeWorker.close(),
      editWorker.close(),
      stemsWorker.close(),
      transcodeQueue.close(),
    ]);
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
