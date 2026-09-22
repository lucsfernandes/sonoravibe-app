import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Song } from '@sonora/db';
import type { GenerationJob, GenerationProgressMessage } from '@sonora/shared';
import { storageKeys } from '@sonora/storage';
import { GenerationProcessor, type ProcessorDeps } from '../src/generation/generation.processor';

/**
 * A capa junto com a música.
 *
 * Ela é desenhada em paralelo ao áudio, não custa crédito e nunca derruba a
 * geração. E a capa pedida à parte, para uma música pronta, não pode mexer no
 * status da música: foi isso que deixou faixas presas em "Carregando…" em
 * produção — a música ficava em `generating_cover` e ninguém a devolvia a
 * `complete`.
 */

/** Uma promessa que o teste resolve quando quiser: segura o motor ou o modelo de imagem. */
function deferido<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

async function ate(condicao: () => boolean, ms = 2000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > ms) throw new Error('a condição não aconteceu a tempo');
    await tick();
  }
}

const AUDIO = {
  audio: { kind: 'buffer' as const, data: Buffer.from('mp3') },
  sourceFormat: 'mp3',
  durationMs: 30_000,
  servedBy: 'mock',
};
const IMAGEM = { data: Buffer.from('png'), mimeType: 'image/png' };

function musica(extra: Record<string, unknown> = {}): Song {
  return {
    id: 'song_1',
    userId: 'u1',
    title: 'Quintal à noite',
    stylePrompt: 'forró pé de serra',
    lyrics: '[Verso]\na lua no quintal\nviolão na parede',
    instrumental: false,
    kind: 'song',
    params: {},
    status: 'queued',
    masterKey: null,
    coverKey: null,
    durationMs: 0,
    ...extra,
  } as unknown as Song;
}

interface Opcoes {
  song?: Song;
  generationStatus?: string;
  motor?: () => Promise<unknown>;
  capa?: () => Promise<{ data: Buffer; mimeType: string } | null>;
}

/** O processador com todas as dependências trocadas por dublês em memória. */
function montar(opcoes: Opcoes = {}) {
  const song = opcoes.song ?? musica();
  const generation = { id: 'gen_1', status: opcoes.generationStatus ?? 'queued' };
  const eventos: GenerationProgressMessage[] = [];
  const atualizacoes: { tabela: 'song' | 'generation'; mudanca: Record<string, unknown> }[] = [];

  const repositorio = (entidade: unknown) => ({
    findOneBy: async () => (entidade === Song ? song : generation),
    update: async (_where: unknown, mudanca: Record<string, unknown>) => {
      atualizacoes.push({ tabela: entidade === Song ? 'song' : 'generation', mudanca });
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
    presignPut: vi.fn(async () => 'https://r2.test/upload'),
    statObject: vi.fn(async () => ({ size: 1 })),
  };
  const credits = {
    commit: vi.fn(async () => undefined),
    refund: vi.fn(async () => ({ refunded: 1 })),
  };
  const router = { generate: vi.fn(opcoes.motor ?? (async () => AUDIO)) };
  const coverArt = { available: true, generate: vi.fn(opcoes.capa ?? (async () => IMAGEM)) };

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
    transcodeQueue: { add: vi.fn(async () => ({})) },
    ffmpegPath: 'ffmpeg',
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  } as unknown as ProcessorDeps);

  const mudancas = (tabela: 'song' | 'generation') =>
    atualizacoes.filter((a) => a.tabela === tabela).map((a) => a.mudanca);

  return {
    processor,
    eventos,
    credits,
    router,
    coverArt,
    mudancasDaMusica: () => mudancas('song'),
    mudancasDaGeracao: () => mudancas('generation'),
  };
}

const MUSICA: GenerationJob = {
  generationId: 'gen_1',
  songId: 'song_1',
  userId: 'u1',
  kind: 'song',
  reservedCredits: 10,
};
const CAPA_NOVA: GenerationJob = {
  ...MUSICA,
  kind: 'cover',
  reservedCredits: 1,
  coverPrompt: 'quintal à noite, luz quente',
};
const CHAVE_CAPA = storageKeys.cover('song_1');
const URL_CAPA = `https://r2.test/${CHAVE_CAPA}`;

describe('capa junto com a música', () => {
  it('parte antes de o motor responder e entra no evento de conclusão', async () => {
    const motor = deferido<typeof AUDIO>();
    const { processor, eventos, coverArt, credits, mudancasDaMusica } = montar({
      motor: () => motor.promessa,
    });

    const rodando = processor.process(MUSICA);
    await ate(() => coverArt.generate.mock.calls.length === 1);

    // Pedida com o motor ainda pendente: paralelo de verdade. E o prompt leva
    // estilo e letra, não só o título.
    expect(coverArt.generate).toHaveBeenCalledWith(expect.stringContaining('forró pé de serra'));
    expect(coverArt.generate).toHaveBeenCalledWith(expect.stringContaining('a lua no quintal'));
    expect(coverArt.generate).not.toHaveBeenCalledWith(expect.stringContaining('[Verso]'));
    expect(eventos.some((e) => e.status === 'complete')).toBe(false);

    motor.resolver(AUDIO);
    await rodando;

    const conclusao = eventos.find((e) => e.status === 'complete');
    expect(conclusao?.song?.coverUrl).toBe(URL_CAPA);
    expect(mudancasDaMusica()).toContainEqual({ coverKey: CHAVE_CAPA });
    // Só o crédito da música: a capa não cobra.
    expect(credits.commit).toHaveBeenCalledTimes(1);
    expect(credits.commit).toHaveBeenCalledWith('u1', 10);
  });

  it('mostra a capa no card antes de a música terminar', async () => {
    const motor = deferido<typeof AUDIO>();
    const { processor, eventos } = montar({ motor: () => motor.promessa });

    const rodando = processor.process(MUSICA);
    await ate(() => eventos.some((e) => Boolean(e.song?.coverUrl)));

    const previa = eventos.find((e) => Boolean(e.song?.coverUrl));
    expect(previa?.generationId).toBe('gen_1');
    expect(previa?.status).not.toBe('complete');
    expect(previa?.song?.coverUrl).toBe(URL_CAPA);

    motor.resolver(AUDIO);
    await rodando;
  });

  it('capa lenta não segura a música', async () => {
    const capa = deferido<typeof IMAGEM>();
    const { processor, eventos } = montar({ capa: () => capa.promessa });

    const rodando = processor.process(MUSICA);
    await ate(() => eventos.some((e) => e.status === 'complete'));
    expect(eventos.find((e) => e.status === 'complete')?.song?.coverUrl).toBeNull();

    capa.resolver(IMAGEM);
    await rodando;

    // Segundo evento de conclusão, agora com a arte.
    const ultimo = eventos[eventos.length - 1];
    expect(ultimo.status).toBe('complete');
    expect(ultimo.song?.coverUrl).toBe(URL_CAPA);
  });

  it('capa que falha não derruba a música', async () => {
    const { processor, eventos, credits, mudancasDaMusica } = montar({
      capa: async () => {
        throw new Error('modelo fora do ar');
      },
    });

    await processor.process(MUSICA);

    expect(eventos.some((e) => e.status === 'failed')).toBe(false);
    expect(mudancasDaMusica()).toContainEqual(expect.objectContaining({ status: 'complete' }));
    expect(credits.refund).not.toHaveBeenCalled();
  });

  it('não roda de novo uma geração já concluída', async () => {
    const { processor, router, coverArt, eventos } = montar({ generationStatus: 'complete' });

    await processor.process(MUSICA);

    expect(router.generate).not.toHaveBeenCalled();
    expect(coverArt.generate).not.toHaveBeenCalled();
    expect(eventos).toHaveLength(0);
  });
});

describe('capa pedida à parte', () => {
  const pronta = () =>
    musica({ status: 'complete', masterKey: 'songs/song_1/master.mp3', durationMs: 30_000 });

  it('não mexe no status da música', async () => {
    const { processor, eventos, credits, mudancasDaMusica, mudancasDaGeracao } = montar({
      song: pronta(),
    });

    await processor.process(CAPA_NOVA);

    expect(mudancasDaMusica()).toEqual([{ coverKey: CHAVE_CAPA }]);
    expect(mudancasDaGeracao().map((m) => m.status)).toEqual(['generating_cover', 'complete']);
    expect(credits.commit).toHaveBeenCalledWith('u1', 1);
    expect(eventos[eventos.length - 1]).toMatchObject({
      status: 'complete',
      song: { coverUrl: URL_CAPA },
    });
  });

  it('quando falha, estorna o crédito e deixa a música em paz', async () => {
    const { processor, eventos, credits, mudancasDaMusica, mudancasDaGeracao } = montar({
      song: pronta(),
      capa: async () => {
        throw new Error('modelo fora do ar');
      },
    });

    await expect(processor.process(CAPA_NOVA)).rejects.toThrow('modelo fora do ar');

    expect(mudancasDaMusica()).toEqual([]);
    expect(mudancasDaGeracao().at(-1)).toMatchObject({ status: 'failed' });
    expect(credits.refund).toHaveBeenCalledWith('gen_1');
    expect(eventos[eventos.length - 1]).toMatchObject({ status: 'failed' });
  });
});
