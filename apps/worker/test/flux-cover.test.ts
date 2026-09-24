import { describe, expect, it, vi } from 'vitest';
import { coverVisualFor } from '../src/generation/cover-art';
import { CoverArtChain, FluxCoverGenerator, fluxCoverPrompt, openRouterSceneWriter, type CoverArtSource } from '../src/generation/flux-cover';

/**
 * Capa pelo FLUX.2 [klein] no endpoint próprio, com o OpenRouter como reserva.
 * A RunPod aqui é um fetch falso com roteiro: /run, /status e /cancel.
 */

const JPEG = Buffer.from('jpeg-bytes');

function runpod(statuses: object[], opts: { runStatus?: number } = {}) {
  const calls: { url: string; method: string; body?: any }[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    let json: object = {};
    let status = 200;
    if (url.endsWith('/run')) {
      status = opts.runStatus ?? 200;
      json = { id: 'job-1', status: 'IN_QUEUE' };
    } else if (url.includes('/status/')) {
      json = statuses[Math.min(i++, statuses.length - 1)];
    }
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = { id: 'job-1', status: 'COMPLETED', output: { image_base64: JPEG.toString('base64'), mime_type: 'image/jpeg' } };
const rapido = { pollIntervalMs: 1, sleep: async () => {} };

describe('FluxCoverGenerator', () => {
  it('pede 1024x1024 ao endpoint, acompanha o job e devolve o JPEG', async () => {
    const { fetchImpl, calls } = runpod([{ id: 'job-1', status: 'IN_PROGRESS' }, ok]);
    const gen = new FluxCoverGenerator({ baseUrl: 'https://api.runpod.ai/v2/img/', apiKey: 'rp', fetchImpl, ...rapido });

    const capa = await gen.generate('Quintal à noite. Estilo: forró');

    expect(capa).toEqual({ mimeType: 'image/jpeg', data: JPEG });
    expect(calls[0].url).toBe('https://api.runpod.ai/v2/img/run');
    expect(calls[0].body.input).toMatchObject({ width: 1024, height: 1024 });
    // Sem `visual` (texto do usuário): vai como veio, com o aviso de não escrever.
    expect(calls[0].body.input.prompt).toContain('Quintal à noite. Estilo: forró');
    expect(calls[0].body.input.prompt).toContain('no words');
  });

  it('sem endpoint configurado não está disponível e não chama nada', async () => {
    const { fetchImpl } = runpod([ok]);
    const gen = new FluxCoverGenerator({ fetchImpl });

    expect(gen.available).toBe(false);
    expect(await gen.generate('x')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lança quando o job falha (para a reserva assumir)', async () => {
    const { fetchImpl } = runpod([{ id: 'job-1', status: 'FAILED', error: 'GPU sem memória' }]);
    const gen = new FluxCoverGenerator({ baseUrl: 'http://img', fetchImpl, ...rapido });

    await expect(gen.generate('x')).rejects.toThrow('GPU sem memória');
  });

  it('desiste depois do tempo máximo e cancela o job', async () => {
    const { fetchImpl, calls } = runpod([{ id: 'job-1', status: 'IN_QUEUE' }]);
    let t = 0;
    const gen = new FluxCoverGenerator({ baseUrl: 'http://img', fetchImpl, timeoutMs: 10, now: () => (t += 6), ...rapido });

    await expect(gen.generate('x')).rejects.toThrow('capa passou de');
    expect(calls.some((c) => c.url.endsWith('/cancel/job-1'))).toBe(true);
  });
});

describe('cena da letra', () => {
  const visual = { style: 'forró', lyrics: 'a lua no quintal / violão na parede' };

  it('o FLUX recebe a cena escrita a partir da letra', async () => {
    const { fetchImpl, calls } = runpod([ok]);
    const sceneWriter = vi.fn(async () => 'a moonlit backyard with a guitar on the wall');
    const gen = new FluxCoverGenerator({ baseUrl: 'http://img', fetchImpl, sceneWriter, ...rapido });

    await gen.generate('Quintal à noite. Tema da letra: a lua no quintal', visual);

    expect(sceneWriter).toHaveBeenCalledWith('a lua no quintal / violão na parede', 'forró');
    expect(calls[0].body.input.prompt).toContain('Scene: a moonlit backyard with a guitar on the wall.');
    expect(calls[0].body.input.prompt).not.toContain('Quintal');
  });

  it('se o escritor de cena falha, a capa sai só com o estilo (sem letra, sem título)', async () => {
    const { fetchImpl, calls } = runpod([ok]);
    const gen = new FluxCoverGenerator({
      baseUrl: 'http://img',
      fetchImpl,
      sceneWriter: async () => {
        throw new Error('OpenRouter fora do ar');
      },
      ...rapido,
    });

    expect(await gen.generate('x', visual)).not.toBeNull();
    expect(calls[0].body.input.prompt).not.toContain('lua');
    expect(calls[0].body.input.prompt).toContain('Music genre and mood: forró.');
  });

  it('o escritor pelo OpenRouter tira aspas e devolve uma frase só', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '"A moonlit backyard."' } }] })),
    ) as unknown as typeof fetch;
    const writer = openRouterSceneWriter({ apiKey: 'k', baseUrl: 'http://or', model: 'm', siteUrl: 'http://s', appName: 'a', fetchImpl })!;

    expect(await writer('a lua', 'forró')).toBe('A moonlit backyard.');
    expect(openRouterSceneWriter({ baseUrl: 'http://or', model: 'm', siteUrl: 'http://s', appName: 'a' })).toBeUndefined();
  });
});

describe('CoverArtChain', () => {
  const fonte = (impl: () => Promise<any>, available = true): CoverArtSource => ({ available, generate: vi.fn(impl) });
  const capa = { mimeType: 'image/png', data: Buffer.from('png') };

  it('repassa as partes visuais para cada fonte', async () => {
    const flux = fonte(async () => capa);
    await new CoverArtChain([{ name: 'flux', source: flux }]).generate('p', { style: 's', lyrics: null });
    expect(flux.generate).toHaveBeenCalledWith('p', { style: 's', lyrics: null });
  });

  it('usa o FLUX quando ele responde e não toca na reserva', async () => {
    const reserva = fonte(async () => capa);
    const chain = new CoverArtChain([
      { name: 'flux', source: fonte(async () => ({ mimeType: 'image/jpeg', data: JPEG })) },
      { name: 'openrouter', source: reserva },
    ]);

    expect(await chain.generate('x')).toEqual({ mimeType: 'image/jpeg', data: JPEG });
    expect(reserva.generate).not.toHaveBeenCalled();
  });

  it('cai na reserva quando o FLUX falha ou volta vazio', async () => {
    const log = vi.fn();
    const falha = new CoverArtChain(
      [
        { name: 'flux', source: fonte(async () => { throw new Error('timeout'); }) },
        { name: 'openrouter', source: fonte(async () => capa) },
      ],
      log,
    );
    expect(await falha.generate('x')).toBe(capa);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('flux falhou (timeout); tentando openrouter'));

    const vazio = new CoverArtChain([
      { name: 'flux', source: fonte(async () => null) },
      { name: 'openrouter', source: fonte(async () => capa) },
    ]);
    expect(await vazio.generate('x')).toBe(capa);
  });

  it('pula fonte indisponível (sem endpoint de imagem, vai direto ao OpenRouter)', async () => {
    const flux = fonte(async () => capa, false);
    const chain = new CoverArtChain([
      { name: 'flux', source: flux },
      { name: 'openrouter', source: fonte(async () => capa) },
    ]);

    expect(chain.available).toBe(true);
    expect(await chain.generate('x')).toBe(capa);
    expect(flux.generate).not.toHaveBeenCalled();
  });

  it('se todas falham, repassa o último erro (o processador trata como sem capa)', async () => {
    const chain = new CoverArtChain([
      { name: 'flux', source: fonte(async () => { throw new Error('a'); }) },
      { name: 'openrouter', source: fonte(async () => { throw new Error('b'); }) },
    ]);
    await expect(chain.generate('x')).rejects.toThrow('b');
  });

  it('com a música: título e versos NÃO vão ao FLUX, só a cena e o estilo', () => {
    const musica = { title: 'Estrada até o mar', stylePrompt: 'pop rock brasileiro', lyrics: '[Verse]\nVou seguir a estrada até o mar', instrumental: false };
    const visual = coverVisualFor(musica);
    const pedido = fluxCoverPrompt('ignorado', visual, 'a road to the sea at sunrise');

    expect(pedido).toContain('Scene: a road to the sea at sunrise.');
    expect(pedido).toContain('Music genre and mood: pop rock brasileiro.');
    expect(pedido).not.toContain('Estrada até o mar');
    expect(pedido).not.toContain('Vou seguir');
    // Sem cena (instrumental ou escritor fora do ar): só o estilo, ainda sem título.
    expect(fluxCoverPrompt('x', { style: 'synthwave', lyrics: null })).not.toContain('Scene:');
  });
});
