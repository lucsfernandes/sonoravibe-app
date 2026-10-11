import { afterEach, describe, expect, it, vi } from 'vitest';
import { kieModelControlsSchema, type MusicGenerationRequest } from '@sonora/shared';
import { KieProvider } from '../src/providers/kie.provider';

const audio = Buffer.from('ID3fake-audio');

function request(overrides: Partial<MusicGenerationRequest> = {}): MusicGenerationRequest {
  return {
    kind: 'song',
    prompt: 'dream pop',
    title: 'Dream Pop Night',
    lyrics: '[Verse]\nStay with me',
    instrumental: false,
    model: 'v6',
    controls: kieModelControlsSchema.parse({
      customMode: true,
      styles: 'dream pop',
      excludeStyles: 'metal',
      durationSeconds: 120,
    }),
    durationSeconds: 120,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KieProvider', () => {
  it('cria, consulta e baixa o resultado do modelo KIE', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input).includes('createTask')) {
        return Response.json({ code: 200, data: { taskId: 'task-1' } });
      }
      if (String(input).includes('recordInfo')) {
        return Response.json({
          code: 200,
          data: {
            taskId: 'task-1',
            state: 'success',
            response: {
              data: [{ audio_url: 'https://cdn.kie.test/song.mp3', duration: 123.4 }],
            },
            creditsConsumed: 30,
          },
        });
      }
      return new Response(audio, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new KieProvider({
      apiKey: 'secret',
      baseUrl: 'https://api.kie.test',
      model: 'V6',
      pollIntervalMs: 500,
    });
    const result = await provider.generate(request());

    expect(result.providerRef).toBe('task-1');
    expect(result.sourceFormat).toBe('mp3');
    expect(result.durationMs).toBe(123400);
    expect(result.audio).toEqual({ kind: 'buffer', data: audio });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: 'ai-music-api/generate',
      input: {
        custom_mode: true,
        instrumental: false,
        model: 'V6',
        style: 'dream pop',
        negative_tags: 'metal',
        duration: 120,
      },
    });
  });

  it('trata code de erro mesmo quando a KIE responde HTTP 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ code: 429, msg: 'Rate limit exceeded' })),
    );

    const provider = new KieProvider({
      apiKey: 'secret',
      baseUrl: 'https://api.kie.test',
      model: 'V6',
    });

    await expect(provider.generate(request())).rejects.toMatchObject({
      providerId: 'kie-v6',
      retryable: true,
    });
  });
});
