import 'reflect-metadata';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreditTransaction, CreditWallet, ENTITIES, Generation, Song, User } from '@sonora/db';
import { DataSource } from 'typeorm';
import { CreditsService, InsufficientCreditsError } from '../src/credits/credits.service';

/**
 * Roda contra o Postgres de desenvolvimento, num schema próprio.
 *
 * O ponto central aqui é a concorrência: o lock de carteira só pode ser
 * verificado com transações de verdade disputando a mesma linha. Um mock
 * passaria por qualquer implementação, inclusive uma sem lock nenhum.
 */

process.loadEnvFile(resolve(__dirname, '../../../.env'));

const SCHEMA = 'sonora_test_credits';
let dataSource: DataSource;
let credits: CreditsService;

const USER_ID = 'user_test_credits';

beforeAll(async () => {
  const admin = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL });
  await admin.initialize();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.destroy();

  dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    schema: SCHEMA,
    entities: ENTITIES,
    synchronize: true,
    logging: false,
  });
  await dataSource.initialize();
  credits = new CreditsService(dataSource);
}, 60_000);

afterAll(async () => {
  if (dataSource?.isInitialized) {
    await dataSource.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await dataSource.destroy();
  }
});

beforeEach(async () => {
  // TRUNCATE com CASCADE limpa tudo de uma vez e não esbarra nas chaves
  // estrangeiras (o TypeORM 1.x recusa delete sem critério, e com razão).
  await dataSource.query(
    `TRUNCATE ${SCHEMA}.credit_transactions, ${SCHEMA}.generations, ${SCHEMA}.songs, ` +
      `${SCHEMA}.credit_wallets, ${SCHEMA}."user" RESTART IDENTITY CASCADE`,
  );
  await dataSource.getRepository(User).save({
    id: USER_ID,
    name: 'Teste',
    email: 'teste@sonora.app',
    emailVerified: true,
    image: null,
  });
});

async function makeGeneration(songTitle = 'Teste'): Promise<Generation> {
  const song = await dataSource.getRepository(Song).save({
    userId: USER_ID,
    title: songTitle,
    status: 'queued',
    kind: 'song',
  });
  return dataSource.getRepository(Generation).save({
    songId: song.id,
    userId: USER_ID,
    kind: 'song',
    status: 'queued',
    providerId: 'acestep',
    creditsCharged: 10,
  });
}

async function ledgerSum(): Promise<number> {
  const row = await dataSource
    .getRepository(CreditTransaction)
    .createQueryBuilder('t')
    .select('COALESCE(SUM(t.amount), 0)', 'total')
    .getRawOne<{ total: string }>();
  return Number(row?.total ?? 0);
}

describe('CreditsService', () => {
  it('consome primeiro o crédito do plano, que expira antes do avulso', async () => {
    await credits.grant(USER_ID, 6, 'plan', 'plan_renewal');
    await credits.grant(USER_ID, 10, 'pack', 'pack_purchase');
    const generation = await makeGeneration();

    const split = await credits.reserve(USER_ID, 10, generation.id);

    expect(split).toEqual({ fromPlan: 6, fromPack: 4 });
    expect(await credits.balanceOf(USER_ID)).toMatchObject({ plan: 0, pack: 6, total: 6, reserved: 10 });
  });

  it('recusa quando falta saldo, sem debitar nada', async () => {
    await credits.grant(USER_ID, 5, 'plan', 'plan_renewal');
    const generation = await makeGeneration();

    await expect(credits.reserve(USER_ID, 10, generation.id)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await credits.balanceOf(USER_ID)).toMatchObject({ plan: 5, total: 5, reserved: 0 });
  });

  it('com saldo para uma só, cinco gerações simultâneas deixam exatamente uma passar', async () => {
    await credits.grant(USER_ID, 10, 'plan', 'plan_renewal');
    const generations = await Promise.all([1, 2, 3, 4, 5].map((i) => makeGeneration(`Simultânea ${i}`)));

    const outcomes = await Promise.allSettled(
      generations.map((g) => credits.reserve(USER_ID, 10, g.id)),
    );
    const aprovadas = outcomes.filter((o) => o.status === 'fulfilled');
    const recusadas = outcomes.filter(
      (o) => o.status === 'rejected' && o.reason instanceof InsufficientCreditsError,
    );

    expect(aprovadas).toHaveLength(1);
    expect(recusadas).toHaveLength(4);
    expect(await credits.balanceOf(USER_ID)).toMatchObject({ total: 0, reserved: 10 });
    expect(await ledgerSum()).toBe(0); // +10 concedidos, -10 consumidos
  }, 30_000);

  it('estorna nos mesmos baldes de onde cobrou', async () => {
    await credits.grant(USER_ID, 6, 'plan', 'plan_renewal');
    await credits.grant(USER_ID, 10, 'pack', 'pack_purchase');
    const generation = await makeGeneration();
    await credits.reserve(USER_ID, 10, generation.id);

    const { refunded } = await credits.refund(generation.id);

    expect(refunded).toBe(10);
    expect(await credits.balanceOf(USER_ID)).toMatchObject({ plan: 6, pack: 10, total: 16, reserved: 0 });
  });

  it('estorno é idempotente: retry do worker não devolve duas vezes', async () => {
    await credits.grant(USER_ID, 10, 'plan', 'plan_renewal');
    const generation = await makeGeneration();
    await credits.reserve(USER_ID, 10, generation.id);

    await credits.refund(generation.id);
    const segunda = await credits.refund(generation.id);

    expect(segunda.refunded).toBe(0);
    expect(await credits.balanceOf(USER_ID)).toMatchObject({ total: 10 });
  });

  it('encerra a reserva ao confirmar, sem mexer no saldo', async () => {
    await credits.grant(USER_ID, 10, 'plan', 'plan_renewal');
    const generation = await makeGeneration();
    await credits.reserve(USER_ID, 10, generation.id);

    await credits.commit(USER_ID, 10);

    expect(await credits.balanceOf(USER_ID)).toMatchObject({ total: 0, reserved: 0 });
    expect(await ledgerSum()).toBe(0);
  });
});
