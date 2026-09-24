import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { FindOperator } from 'typeorm';
import { Song } from '@sonora/db';
import type { GenerationJob, GenerationProgressMessage, MusicGenerationRequest } from '@sonora/shared';
import { storageKeys } from '@sonora/storage';
import { GenerationProcessor, type ProcessorDeps } from '../src/generation/generation.processor';

/**
 * Duas faixas por pedido.
 *
 * Uma música nova sai em duas versões da MESMA chamada ao motor. Cada versão é
 * uma música na biblioteca, com a própria Generation (é por ela que o SSE e o
 * cancelamento enxergam a faixa), mas o pedido é uma unidade: um job, uma
 * cobrança, um estorno, um desfecho.
 */

const AUDIO = (nome: string) => ({
  audio: { kind: 'buffer' as const, data: Buffer.from(nome) },
  sourceFormat: 'flac',
  durationMs: 30_000,
});
const IMAGEM = { data: Buffer.from('png'), mimeType: 'image/png' };

const JOB: GenerationJob = {
  generationId: 'gen_1',
  songId: 'song_1',
  userId: 'u1',
  kind: 'song',
  reservedCredits: 10,
  variants: [{ generationId: 'gen_2', songId: 'song_2' }],
};

function musica(id: string): Song {
  return {
    id,
    userId: 'u1',
    title: 'Quintal à noite',
    stylePrompt: 'forró pé de serra',
    lyrics: '[Verso]\na lua no quintal',
    instrumental: false,
    kind: 'song',
    params: {},
    status: 'queued',
    masterKey: null,
    coverKey: null,
    durationMs: 0,
  } as unknown as Song;
}

/** Os ids de um `where` que pode ser `{ id }` ou `{ id: In([...]) }`. */
function idsDe(where: { id: unknown }): string[] {
  return where.id instanceof FindOperator ? (where.id.value as string[]) : [where.id as string];
}

interface Opcoes {
  /** O que o motor devolve; recebe o pedido para o teste poder inspecioná-lo. */
  motor: (req: MusicGenerationRequest) => Promise<unknown>;
  /** Status da Generation da variante quando o processor a carrega. */
  statusDaVariante?: string;
}

function montar(opcoes: Opcoes) {
  const songs: Record<string, Song> = { song_1: musica('song_1'), song_2: musica('song_2') };
  const generations: Record<string, { id: string; status: string }> = {
    gen_1: { id: 'gen_1', status: 'queued' },
    gen_2: { id: 'gen_2', status: opcoes.statusDaVariante ?? 'queued' },
  };

  const eventos: GenerationProgressMessage[] = [];
  const atualizacoes: { tabela: 'song' | 'generation'; ids: string[]; mudanca: Record<string, unknown> }[] = [];
  const lixeira: string[] = [];

  const repositorio = (entidade: unknown) => ({
    findOneBy: async ({ id }: { id: string }) => (entidade === Song ? songs[id] : generations[id]),
    update: async (where: { id: unknown }, mudanca: Record<string, unknown>) => {
      atualizacoes.push({ tabela: entidade === Song ? 'song' : 'generation', ids: idsDe(where), mudanca });
    },
    softDelete: async (where: { id: unknown }) => {
      lixeira.push(...idsDe(where));
    },
  });
  const dataSource = {
    getRepository: repositorio,
    transaction: async (fn: (em: { getRepository: typeof repositorio }) => Promise<unknown>) =>
      fn({ getRepository: repositorio }),
  };

  const storage = {
    putObject: vi.fn(async () => undefined),
    presignGet: vi.fn(async (key: string) => `https://r2.test/${key}`),
    presignPut: vi.fn(async (key: string) => `https://r2.test/put/${key}`),
    statObject: vi.fn(async () => ({ size: 1 })),
  };
  const credits = {
    commit: vi.fn(async () => undefined),
    refund: vi.fn(async () => ({ refunded: 10 })),
  };
  const router = { generate: vi.fn(opcoes.motor) };
  const coverArt = { available: true, generate: vi.fn(async () => IMAGEM) };
  const transcodeQueue = { add: vi.fn(async () => ({})) };

  const processor = new GenerationProcessor({
    dataSource,
    storage,
    credits,
    router,
    coverArt,
    redis: {
      publish: async (_canal: string, corpo: string) => {
        eventos.push(JSON.parse(corpo) as GenerationProgressMessage);
        return 1;
      },
    },
    transcodeQueue,
    ffmpegPath: 'ffmpeg',
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  } as unknown as ProcessorDeps);

  const mudancasDe = (tabela: 'song' | 'generation', id: string) =>
    atualizacoes.filter((a) => a.tabela === tabela && a.ids.includes(id)).map((a) => a.mudanca);

  return { processor, eventos, credits, router, coverArt, transcodeQueue, lixeira, mudancasDe };
}

const doMotor = (variants?: unknown[]) => async () => ({
  ...AUDIO('a'),
  servedBy: 'acestep',
  providerRef: 'rp-1',
  ...(variants ? { variants } : {}),
});

describe('duas faixas do mesmo pedido', () => {
  it('gera as duas numa chamada só e conclui cada uma com o seu áudio', async () => {
    const { processor, eventos, credits, router, coverArt, transcodeQueue, mudancasDe } = montar({
      motor: doMotor([AUDIO('b')]),
    });

    await processor.process(JOB);

    // Uma chamada ao motor, com um destino de upload por faixa.
    expect(router.generate).toHaveBeenCalledTimes(1);
    const pedido = router.generate.mock.calls[0][0] as MusicGenerationRequest;
    expect(pedido.uploadTarget?.storageKey).toBe(storageKeys.master('song_1', 'flac'));
    expect(pedido.variantUploadTargets).toEqual([
      expect.objectContaining({ storageKey: storageKeys.master('song_2', 'flac') }),
    ]);

    // Cada música fica pronta com o master dela.
    for (const [song, generation] of [['song_1', 'gen_1'], ['song_2', 'gen_2']] as const) {
      expect(mudancasDe('song', song)).toContainEqual(
        expect.objectContaining({ status: 'complete', masterKey: storageKeys.master(song, 'flac') }),
      );
      expect(mudancasDe('generation', generation)).toContainEqual(expect.objectContaining({ status: 'complete' }));
    }

    // Um evento de conclusão por faixa, cada um com o áudio e o id dela.
    const conclusoes = eventos.filter((e) => e.status === 'complete' && e.song?.audioUrl);
    expect(conclusoes.map((e) => [e.generationId, e.songId]).sort()).toEqual([
      ['gen_1', 'song_1'],
      ['gen_2', 'song_2'],
    ]);
    expect(new Set(conclusoes.map((e) => e.song?.audioUrl)).size).toBe(2);

    // O pedido é cobrado uma vez, e cada faixa ganha a sua capa e o seu trabalho de fundo.
    expect(credits.commit).toHaveBeenCalledTimes(1);
    expect(credits.commit).toHaveBeenCalledWith('u1', 10);
    expect(coverArt.generate).toHaveBeenCalledTimes(2);
    const jobsDeFundo = transcodeQueue.add.mock.calls.map((c) => (c as unknown[])[1] as { songId: string });
    expect(new Set(jobsDeFundo.map((j) => j.songId))).toEqual(new Set(['song_1', 'song_2']));
  });

  it('acompanha o progresso das duas faixas juntas', async () => {
    const { processor, eventos } = montar({ motor: doMotor([AUDIO('b')]) });

    await processor.process(JOB);

    for (const generationId of ['gen_1', 'gen_2']) {
      const etapas = eventos.filter((e) => e.generationId === generationId).map((e) => e.status);
      expect(etapas).toContain('generating_audio');
      expect(etapas).toContain('uploading');
    }
  });

  it('quando o motor de reserva entrega só uma faixa, descarta a outra sem cobrar a mais nem marcar falha', async () => {
    const { processor, eventos, credits, lixeira, mudancasDe } = montar({ motor: doMotor() });

    await processor.process(JOB);

    // A primária conclui normalmente.
    expect(mudancasDe('song', 'song_1')).toContainEqual(expect.objectContaining({ status: 'complete' }));

    // A que ficou sem áudio some da biblioteca: cancelada e na lixeira, nunca "failed".
    expect(mudancasDe('generation', 'gen_2')).toContainEqual(expect.objectContaining({ status: 'canceled' }));
    expect(mudancasDe('song', 'song_2')).toContainEqual({ status: 'canceled' });
    expect(lixeira).toEqual(['song_2']);
    expect(eventos.some((e) => e.generationId === 'gen_2' && e.status === 'canceled')).toBe(true);
    expect(eventos.some((e) => e.status === 'failed')).toBe(false);

    // O crédito é do pedido, que foi atendido.
    expect(credits.commit).toHaveBeenCalledTimes(1);
    expect(credits.refund).not.toHaveBeenCalled();
  });

  it('falha derruba as duas e estorna uma vez só, pela primária', async () => {
    const { processor, eventos, credits, mudancasDe } = montar({
      motor: async () => {
        throw new Error('GPU sem memória');
      },
    });

    await expect(processor.process(JOB)).rejects.toThrow('GPU sem memória');

    for (const [song, generation] of [['song_1', 'gen_1'], ['song_2', 'gen_2']] as const) {
      expect(mudancasDe('generation', generation).at(-1)).toMatchObject({ status: 'failed' });
      expect(mudancasDe('song', song).at(-1)).toEqual({ status: 'failed' });
    }
    expect(eventos.filter((e) => e.status === 'failed').map((e) => e.generationId).sort()).toEqual(['gen_1', 'gen_2']);
    expect(credits.refund).toHaveBeenCalledTimes(1);
    expect(credits.refund).toHaveBeenCalledWith('gen_1');
    expect(credits.commit).not.toHaveBeenCalled();
  });

  it('deixa de fora a variante cancelada enquanto esperava na fila', async () => {
    const { processor, router, coverArt, mudancasDe } = montar({
      motor: doMotor(),
      statusDaVariante: 'canceled',
    });

    await processor.process(JOB);

    const pedido = router.generate.mock.calls[0][0] as MusicGenerationRequest;
    expect(pedido.variantUploadTargets).toBeUndefined();
    expect(coverArt.generate).toHaveBeenCalledTimes(1);
    // Nem chega a mexer nela: já estava cancelada.
    expect(mudancasDe('song', 'song_2')).toEqual([]);
  });

  it('um pedido sem variantes segue como antes', async () => {
    const { processor, router, coverArt } = montar({ motor: doMotor() });

    await processor.process({ ...JOB, variants: undefined });

    const pedido = router.generate.mock.calls[0][0] as MusicGenerationRequest;
    expect(pedido.variantUploadTargets).toBeUndefined();
    expect(coverArt.generate).toHaveBeenCalledTimes(1);
  });
});
