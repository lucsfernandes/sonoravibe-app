import 'reflect-metadata';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTITIES, Generation, Song, User } from '@sonora/db';
import { CREDIT_COSTS, effectiveDuration, generationRequestSchema, songCreditCost, type GenerationJob } from '@sonora/shared';
import { DataSource } from 'typeorm';
import type { SessionUser } from '../src/auth/session.guard';
import type { AppConfig } from '../src/config/env';
import { CreditsService } from '../src/credits/credits.service';
import { GenerationsService } from '../src/generations/generations.service';
import type { PlansService } from '../src/plans/plans.service';
import { SongsService } from '../src/songs/songs.service';

/**
 * Duas faixas por pedido, de ponta a ponta no banco.
 *
 * Uma música nova vira duas Songs e duas Generations, mas um job na fila e uma
 * cobrança. O que estes testes seguram: o crédito é reservado UMA vez (na
 * Generation da primária), as faixas extras se acham pelo `jobId`, e cancelar
 * qualquer uma cancela o pedido e estorna uma vez só. Roda contra um Postgres de
 * verdade, num schema próprio — o ledger e as transações não se verificam com mock.
 */

process.loadEnvFile(resolve(__dirname, '../../../.env'));
const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const SCHEMA = 'sonora_test_variantes';
const USER_ID = 'user_test_variantes';
const USER = { id: USER_ID } as SessionUser;

let dataSource: DataSource;
let credits: CreditsService;
let songs: SongsService;
let generations: GenerationsService;

const queue = { add: vi.fn(), getJob: vi.fn() };
const events = { publish: vi.fn() };

const plans = {
  planOf: async () => ({
    code: 'free',
    features: { maxMode: false, queuePriority: 10, maxDurationSeconds: 120 },
  }),
} as unknown as PlansService;

beforeAll(async () => {
  const admin = new DataSource({ type: 'postgres', url: DB_URL });
  await admin.initialize();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // A tabela `user` é do Better Auth (a entidade é `synchronize: false`): sem
  // criá-la à mão, as chaves estrangeiras de Song e Generation não têm alvo.
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
  songs = new SongsService(
    dataSource,
    queue as never,
    credits,
    plans,
    { MUSIC_PROVIDER: 'acestep' } as AppConfig,
  );
  generations = new GenerationsService(dataSource, queue as never, credits, events as never);
}, 180_000);

afterAll(async () => {
  if (dataSource?.isInitialized) {
    await dataSource.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await dataSource.destroy();
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  queue.add.mockImplementation(async (_name: string, _job: GenerationJob, opts: { jobId: string }) => ({
    id: opts.jobId,
  }));
  queue.getJob.mockResolvedValue(null);

  await dataSource.query(
    `TRUNCATE ${SCHEMA}.credit_transactions, ${SCHEMA}.generations, ${SCHEMA}.songs, ` +
      `${SCHEMA}.credit_wallets, ${SCHEMA}."user" RESTART IDENTITY CASCADE`,
  );
  await dataSource.getRepository(User).save({
    id: USER_ID,
    name: 'Teste',
    email: 'variantes@sonora.app',
    emailVerified: true,
    image: null,
  });
  await credits.grant(USER_ID, 50, 'plan', 'plan_renewal');
});

const pedidoSimples = generationRequestSchema.parse({
  mode: 'simple',
  prompt: 'forró pé de serra com sanfona',
  instrumental: false,
});
/** Pedido Simple sem versão nem duração, no Free (teto de 2 min): v1 cobrada pelo teto do plano. */
const CUSTO_PADRAO = songCreditCost('v1', effectiveDuration(undefined, 120));

describe('generate: duas faixas por música nova', () => {
  it('cria duas músicas e duas gerações, um job e uma reserva', async () => {
    const r = await songs.generate(USER, pedidoSimples);

    expect(r.variants).toHaveLength(2);
    expect(r.variants[0]).toEqual({ songId: r.songId, generationId: r.generationId });
    expect(r.creditsCharged).toBe(CUSTO_PADRAO);

    const musicas = await dataSource.getRepository(Song).find({ where: { userId: USER_ID } });
    const geracoes = await dataSource.getRepository(Generation).find({ where: { userId: USER_ID } });
    expect(musicas).toHaveLength(2);
    expect(geracoes).toHaveLength(2);
    // As duas nascem do mesmo pedido: mesmo estilo, mesmo título.
    expect(new Set(musicas.map((m) => m.stylePrompt)).size).toBe(1);
    expect(new Set(musicas.map((m) => m.title)).size).toBe(1);

    // Um job só, levando a outra faixa como variante.
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, job, opts] = queue.add.mock.calls[0] as [string, GenerationJob, { jobId: string }];
    expect(opts.jobId).toBe(r.generationId);
    expect(job.reservedCredits).toBe(CUSTO_PADRAO);
    expect(job.variants).toEqual([r.variants[1]]);
  });

  it('cobra uma vez: o crédito fica só na geração da primária', async () => {
    const r = await songs.generate(USER, pedidoSimples);

    const primaria = await dataSource.getRepository(Generation).findOneByOrFail({ id: r.generationId });
    const extra = await dataSource.getRepository(Generation).findOneByOrFail({ id: r.variants[1].generationId });
    expect(primaria.creditsCharged).toBe(CUSTO_PADRAO);
    expect(extra.creditsCharged).toBe(0);
    // A extra aponta para o job da primária: é assim que o cancelamento a acha.
    expect(extra.jobId).toBe(r.generationId);

    expect(await credits.balanceOf(USER_ID)).toMatchObject({ total: 50 - CUSTO_PADRAO, reserved: CUSTO_PADRAO });
  });

  it('remix e clipe continuam com uma faixa só', async () => {
    const clipe = await songs.generate(
      USER,
      generationRequestSchema.parse({ mode: 'sounds', prompt: 'kick seco de 808', soundType: 'one-shot', key: 'any' }),
    );
    expect(clipe.variants).toHaveLength(1);

    const origem = await dataSource.getRepository(Song).save({
      userId: USER_ID,
      title: 'Base',
      status: 'complete',
      kind: 'song',
      masterKey: 'songs/base/master.flac',
    });
    const remix = await songs.generate(
      USER,
      generationRequestSchema.parse({ mode: 'simple', prompt: 'forró com sanfona', sourceSongId: origem.id }),
    );
    expect(remix.creditsCharged).toBe(CREDIT_COSTS.remix);
    expect(remix.variants).toHaveLength(1);

    const [, jobDoRemix] = queue.add.mock.calls[1] as [string, GenerationJob];
    expect(jobDoRemix.kind).toBe('remix');
    expect(jobDoRemix.variants).toBeUndefined();
  });

  it('sem saldo, falha as duas faixas e não enfileira nada', async () => {
    await dataSource.query(`TRUNCATE ${SCHEMA}.credit_transactions, ${SCHEMA}.credit_wallets CASCADE`);

    await expect(songs.generate(USER, pedidoSimples)).rejects.toMatchObject({ status: 402 });

    const musicas = await dataSource.getRepository(Song).find({ where: { userId: USER_ID } });
    expect(musicas.map((m) => m.status)).toEqual(['failed', 'failed']);
    const geracoes = await dataSource.getRepository(Generation).find({ where: { userId: USER_ID } });
    expect(geracoes.map((g) => g.status)).toEqual(['failed', 'failed']);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('generate: versão do motor', () => {
  const avancado = (model: string, durationSeconds?: number, extra: Record<string, unknown> = {}) =>
    generationRequestSchema.parse({
      mode: 'advanced',
      model,
      ...extra,
      instrumental: true,
      controls: { styles: 'midnight retrowave', ...(durationSeconds ? { durationSeconds } : {}) },
    });

  it('cobra pela versão e pela faixa de duração', async () => {
    await credits.grant(USER_ID, 200, 'plan', 'plan_renewal');

    expect((await songs.generate(USER, avancado('v1', 120))).creditsCharged).toBe(10);
    expect((await songs.generate(USER, avancado('v2.0', 120))).creditsCharged).toBe(20);
    expect((await songs.generate(USER, avancado('v2.5', 60))).creditsCharged).toBe(26);
    // Duração no automático num plano de 2 min: cobrada (e gerada) pelo teto do plano.
    expect((await songs.generate(USER, avancado('v2.5'))).creditsCharged).toBe(26);
  });

  it('no automático, o Free paga e gera pelo teto do plano (2 min), não por 4 min', async () => {
    const r = await songs.generate(USER, pedidoSimples);

    expect(r.creditsCharged).toBe(10);
    const musica = await dataSource.getRepository(Song).findOneByOrFail({ id: r.songId });
    expect((musica.params as { durationSeconds?: number }).durationSeconds).toBe(120);
  });

  it('grava a versão na música, que é o que o worker lê', async () => {
    const r = await songs.generate(USER, avancado('v2.5', 120));

    const musicas = await dataSource.getRepository(Song).find({ where: { userId: USER_ID } });
    expect(musicas.map((m) => (m.params as { model?: string }).model)).toEqual(['v2.5', 'v2.5']);
    const [, job] = queue.add.mock.calls[0] as [string, GenerationJob];
    expect(job.reservedCredits).toBe(r.creditsCharged);
  });

  it('remix ignora a versão: roda e cobra como sempre', async () => {
    const origem = await dataSource.getRepository(Song).save({
      userId: USER_ID,
      title: 'Base',
      status: 'complete',
      kind: 'song',
      masterKey: 'songs/base/master.flac',
    });
    const r = await songs.generate(USER, avancado('v2.5', 120, { sourceSongId: origem.id }));

    expect(r.creditsCharged).toBe(CREDIT_COSTS.remix);
    const remix = await dataSource.getRepository(Song).findOneByOrFail({ id: r.songId });
    expect((remix.params as { model?: string }).model).toBe('v1');
  });
});

describe('cancel: o pedido é uma unidade', () => {
  const remover = vi.fn(async () => undefined);

  beforeEach(() => {
    remover.mockClear();
    queue.getJob.mockResolvedValue({ id: 'job', getState: async () => 'waiting', remove: remover });
  });

  it.each([
    ['a primária', 0],
    ['a variante', 1],
  ])('cancelar %s cancela as duas, remove o job uma vez e estorna uma vez', async (_nome, indice) => {
    const r = await songs.generate(USER, pedidoSimples);

    const { refunded } = await generations.cancel(USER_ID, r.variants[indice].generationId);

    expect(refunded).toBe(CUSTO_PADRAO);
    const geracoes = await dataSource.getRepository(Generation).find({ where: { userId: USER_ID } });
    expect(geracoes.map((g) => g.status)).toEqual(['canceled', 'canceled']);
    const musicas = await dataSource.getRepository(Song).find({ where: { userId: USER_ID } });
    expect(musicas.map((m) => m.status)).toEqual(['canceled', 'canceled']);

    expect(remover).toHaveBeenCalledTimes(1);
    expect(await credits.balanceOf(USER_ID)).toMatchObject({ total: 50, reserved: 0 });

    // Um evento por faixa, para as duas saírem da tela.
    expect(events.publish).toHaveBeenCalledTimes(2);
    expect(events.publish.mock.calls.map((c) => (c[0] as { generationId: string }).generationId).sort()).toEqual(
      r.variants.map((v) => v.generationId).sort(),
    );
  });

  it('recusa cancelar o que já terminou', async () => {
    const r = await songs.generate(USER, pedidoSimples);
    await dataSource
      .getRepository(Generation)
      .update({ id: r.generationId }, { status: 'complete' });

    await expect(generations.cancel(USER_ID, r.generationId)).rejects.toMatchObject({ status: 409 });
  });

  it('não deixa cancelar a geração de outra pessoa', async () => {
    const r = await songs.generate(USER, pedidoSimples);

    await expect(generations.cancel('outro_usuario', r.variants[1].generationId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
