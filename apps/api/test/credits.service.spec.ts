import 'reflect-metadata';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreditTransaction, CreditWallet, ENTITIES, Generation, Song, User } from '@sonora/db';
import { DataSource } from 'typeorm';
import { CreditsService, InsufficientCreditsError } from '../src/credits/credits.service';

/**
 * Roda contra um Postgres de verdade, num schema próprio.
 *
 * O ponto central aqui é a concorrência: o lock de carteira só pode ser
 * verificado com transações de verdade disputando a mesma linha. Um mock
 * passaria por qualquer implementação, inclusive uma sem lock nenhum.
 */

process.loadEnvFile(resolve(__dirname, '../../../.env'));

/**
 * Prefere `TEST_DATABASE_URL` quando existir.
 *
 * Sem isso o teste roda no mesmo banco de `DATABASE_URL` — que hoje é o de
 * produção. Ele cria e derruba um schema só seu e nunca toca em `public`, mas
 * "rodar o teste faz DDL em produção" é a classe de coisa que funciona até o
 * dia em que alguém muda o nome do schema.
 */
const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const SCHEMA = 'sonora_test_credits';
let dataSource: DataSource;
let credits: CreditsService;

const USER_ID = 'user_test_credits';

beforeAll(async () => {
  const admin = new DataSource({ type: 'postgres', url: DB_URL });
  await admin.initialize();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);

  // A tabela `user` é do Better Auth, não do TypeORM (a entidade é
  // `synchronize: false`), então aqui ela é criada à mão — carteiras e gerações
  // têm chave estrangeira para ela e o sync falharia sem isso.
  await admin.query(`
    CREATE TABLE ${SCHEMA}."user" (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      "emailVerified" boolean NOT NULL DEFAULT false,
      image text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Se o Better Auth mudar o schema dele, este fixture silenciosamente deixa de
  // representar a tabela real. A comparação abaixo transforma isso num teste
  // que falha, em vez de numa surpresa em produção.
  const [real, fixture] = await Promise.all([
    columnsOf(admin, 'public'),
    columnsOf(admin, SCHEMA),
  ]);
  if (real.length > 0 && real.join(',') !== fixture.join(',')) {
    throw new Error(
      `O fixture da tabela "user" divergiu da real.
` +
        `  real (public): ${real.join(', ')}
` +
        `  fixture:       ${fixture.join(', ')}`,
    );
  }

  await admin.destroy();

  dataSource = new DataSource({
    type: 'postgres',
    url: DB_URL,
    schema: SCHEMA,
    entities: ENTITIES,
    synchronize: true,
    logging: false,
  });
  await dataSource.initialize();
  credits = new CreditsService(dataSource);
  // 60s era apertado demais: contra um Postgres remoto o `synchronize` das ~20
  // entidades leva ~10s, mas o conjunto (conexão fria + DDL + a comparação do
  // fixture) encosta no limite e o teste falhava de forma intermitente, sempre
  // no hook e nunca numa asserção — o sintoma mais confuso possível.
}, 180_000);

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

/** Colunas da tabela `user` num schema, em ordem, para comparar fixture e real. */
async function columnsOf(ds: DataSource, schema: string): Promise<string[]> {
  const rows = await ds.query<{ column_name: string }[]>(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = 'user' order by column_name`,
    [schema],
  );
  return rows.map((r) => r.column_name);
}

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
