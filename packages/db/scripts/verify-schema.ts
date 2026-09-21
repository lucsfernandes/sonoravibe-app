/**
 * Cria o schema a partir das entidades num schema temporário do Postgres,
 * grava um fluxo completo e lê de volta. Prova que os decorators, tipos e
 * relações funcionam contra o banco real — não só que compilam.
 *
 * Usa um schema separado e o apaga no fim, então não toca no schema public.
 *
 * Uso: pnpm --filter @sonora/db exec tsx scripts/verify-schema.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  CreditTransaction,
  CreditWallet,
  ENTITIES,
  Generation,
  Profile,
  Song,
  User,
  Workspace,
} from '../src/index';

process.loadEnvFile(new URL('../../../.env', import.meta.url).pathname.replace(/^\//, ''));

const SCHEMA = 'sonora_verify';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  schema: SCHEMA,
  entities: ENTITIES,
  synchronize: true,
  logging: false,
});

async function main(): Promise<void> {
  const raw = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL });
  await raw.initialize();
  await raw.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await raw.query(`CREATE SCHEMA ${SCHEMA}`);
  await raw.destroy();

  await dataSource.initialize();
  const tables: { table_name: string }[] = await dataSource.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [SCHEMA],
  );
  console.log(`  Tabelas criadas (${tables.length}): ${tables.map((t) => t.table_name).join(', ')}`);

  const user = await dataSource.getRepository(User).save({
    id: 'user_verify_1',
    name: 'Lucas',
    email: 'verify@sonora.app',
    emailVerified: true,
    image: null,
  });
  await dataSource.getRepository(Profile).save({
    userId: user.id,
    handle: 'lucas',
    displayName: 'Lucas',
    bio: null,
    avatarKey: null,
    pinnedSongId: null,
  });
  const workspace = await dataSource.getRepository(Workspace).save({
    userId: user.id,
    name: 'Meu Workspace',
    isDefault: true,
  });
  const song = await dataSource.getRepository(Song).save({
    userId: user.id,
    workspaceId: workspace.id,
    title: 'Estrada até o mar',
    stylePrompt: 'Brazilian pop rock',
    lyrics: '[Verse]\nAcordei com o sol',
    instrumental: false,
    status: 'queued',
    kind: 'song',
    providerId: 'acestep',
    // jsonb: precisa sobreviver à ida e volta
    params: { bpm: 104, key: 'G', weirdness: 50 },
  });
  const generation = await dataSource.getRepository(Generation).save({
    songId: song.id,
    userId: user.id,
    kind: 'song',
    status: 'queued',
    providerId: 'acestep',
    creditsCharged: 10,
  });
  const wallet = await dataSource.getRepository(CreditWallet).save({
    userId: user.id,
    planBalance: 5000,
    packBalance: 0,
    reservedBalance: 0,
  });
  await dataSource.getRepository(CreditTransaction).save({
    walletId: wallet.id,
    generationId: generation.id,
    amount: -10,
    bucket: 'plan',
    reason: 'generation',
    balanceAfter: 4990,
    description: 'música completa',
  });

  const loaded = await dataSource.getRepository(Song).findOne({
    where: { id: song.id },
    relations: { user: true, workspace: true, generations: true },
  });
  console.log(
    `  Leitura com relações: música "${loaded?.title}" de ${loaded?.user.email}, ` +
      `workspace "${loaded?.workspace?.name}", ${loaded?.generations.length} geração`,
  );
  console.log(`  jsonb preservado: ${JSON.stringify(loaded?.params)}`);

  const ledger = await dataSource
    .getRepository(CreditTransaction)
    .createQueryBuilder('t')
    .select('SUM(t.amount)', 'saldo')
    .where('t.wallet_id = :walletId', { walletId: wallet.id })
    .getRawOne<{ saldo: string }>();
  console.log(`  Soma do ledger (fonte da verdade do saldo): ${ledger?.saldo}`);

  // Exclusão lógica: a música some da biblioteca mas continua no banco.
  await dataSource.getRepository(Song).softDelete(song.id);
  const afterSoftDelete = await dataSource.getRepository(Song).findOne({ where: { id: song.id } });
  const withDeleted = await dataSource
    .getRepository(Song)
    .findOne({ where: { id: song.id }, withDeleted: true });
  console.log(
    `  Lixeira: busca normal ${afterSoftDelete ? 'AINDA ACHA (errado)' : 'não acha'}, ` +
      `com withDeleted ${withDeleted ? 'acha' : 'NÃO ACHA (errado)'}`,
  );

  await dataSource.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await dataSource.destroy();
  console.log('  Schema temporário removido.');
}

main().catch(async (err) => {
  console.error(`\nFALHOU: ${err.message}`);
  if (dataSource.isInitialized) await dataSource.destroy().catch(() => {});
  process.exitCode = 1;
});
