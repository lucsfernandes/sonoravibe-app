import 'reflect-metadata';
import { resolve } from 'node:path';
import { ENTITIES, Song } from '@sonora/db';
import { StorageService } from '@sonora/storage';
import { DataSource, IsNull, Not } from 'typeorm';
import { durationOfBuffer } from './audio/ffmpeg';
import { loadWorkerConfig } from './config';

/**
 * Preenche a duração das músicas que nasceram com 0.
 *
 * O Lyria não informa duração e, até a correção em `generation.processor`,
 * esse zero ia direto para o banco: a música aparecia como "0:00" e todo
 * formato de download era estimado em "~0 MB". A geração nova já mede, e o
 * `transcode.processor` preenche o que passar por ele — mas uma música cujos
 * formatos já foram convertidos nunca mais passa por lá, e ficaria errada para
 * sempre.
 *
 * Roda uma vez, é idempotente (só toca no que está zerado) e é seguro repetir.
 *
 * Dentro do cluster, como Job, igual ao de schema:
 *   node -r @swc-node/register src/backfill-duracao.ts
 */

try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // Sem .env: seguimos com o ambiente do processo, que é o caso no cluster.
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  const dataSource = new DataSource({
    type: 'postgres',
    url: config.DATABASE_URL,
    entities: ENTITIES,
    synchronize: false,
    logging: ['error'],
  });
  await dataSource.initialize();

  const storage = new StorageService({
    accountId: config.R2_ACCOUNT_ID,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    bucket: config.R2_BUCKET,
    publicUrl: config.R2_PUBLIC_URL,
    endpoint: config.R2_ENDPOINT,
  });

  const repo = dataSource.getRepository(Song);
  const pendentes = await repo.find({
    where: { durationMs: 0, masterKey: Not(IsNull()), status: 'complete' },
    select: { id: true, masterKey: true, title: true },
  });

  console.log(`${pendentes.length} música(s) com duração zerada.`);

  let corrigidas = 0;
  for (const song of pendentes) {
    if (!song.masterKey) continue;
    try {
      // Baixa o master inteiro: é o único jeito de medir com precisão, e são
      // poucos megabytes por faixa numa rotina que roda uma vez.
      const audio = await storage.getObject(song.masterKey);
      const extensao = song.masterKey.split('.').pop() ?? 'flac';
      const durationMs = await durationOfBuffer(audio, extensao, config.FFMPEG_PATH);

      if (durationMs === 0) {
        console.warn(`  ${song.id}: não consegui medir, deixei como estava.`);
        continue;
      }

      // A condição `durationMs: 0` no WHERE evita sobrescrever uma medição que
      // outro processo tenha gravado enquanto este script rodava.
      await repo.update({ id: song.id, durationMs: 0 }, { durationMs });
      corrigidas++;
      console.log(`  ${song.id}: ${(durationMs / 1000).toFixed(1)}s — ${song.title.slice(0, 50)}`);
    } catch (err) {
      // Uma faixa ilegível não pode abortar o lote: o resto continua valendo.
      console.warn(`  ${song.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n${corrigidas} de ${pendentes.length} corrigida(s).`);
  await dataSource.destroy();
}

main().catch((err) => {
  console.error(`\nFalhou: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
