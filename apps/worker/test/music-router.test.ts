import { describe, expect, it, vi } from 'vitest';
import {
  advancedControlsSchema,
  MusicProviderError,
  type GenerationKind,
  type MusicGenerationRequest,
  type MusicGenerationResult,
  type MusicProvider,
} from '@sonora/shared';
import { MusicRouter } from '../src/providers/music-router';

function fakeProvider(
  id: string,
  // `fail` aceita Error comum de propósito: o caso mais perigoso é justamente
  // o erro que NÃO é MusicProviderError, que não pode escalar para o motor pago.
  opts: { kinds?: GenerationKind[]; maxDuration?: number; fail?: Error } = {},
): MusicProvider & { generate: ReturnType<typeof vi.fn> } {
  const result: MusicGenerationResult = {
    audio: { kind: 'buffer', data: Buffer.from(id) },
    sourceFormat: 'mp3',
    durationMs: 1000,
  };
  return {
    id,
    displayName: id,
    maxDurationSeconds: opts.maxDuration ?? 180,
    supportedKinds: opts.kinds ?? ['song', 'clip'],
    estimateCredits: () => 10,
    generate: vi.fn(async () => {
      if (opts.fail) throw opts.fail;
      return result;
    }),
  };
}

function request(overrides: Partial<MusicGenerationRequest> = {}): MusicGenerationRequest {
  return {
    kind: 'song',
    prompt: 'lofi',
    lyrics: null,
    instrumental: true,
    controls: advancedControlsSchema.parse({}),
    ...overrides,
  };
}

const retryable = (id: string) => new MusicProviderError('sem GPU', id, true);
const fatal = (id: string) => new MusicProviderError('entrada inválida', id, false);

describe('MusicRouter', () => {
  it('usa o principal quando ele funciona', async () => {
    const primary = fakeProvider('acestep', { maxDuration: 480 });
    const fallback = fakeProvider('lyria');
    const router = new MusicRouter(primary, fallback);

    const result = await router.generate(request());

    expect(result.servedBy).toBe('acestep');
    expect(result.fallbackReason).toBeUndefined();
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it('cai na reserva em erro retentável e avisa quem está monitorando o custo', async () => {
    const onFallback = vi.fn();
    const router = new MusicRouter(
      fakeProvider('acestep', { maxDuration: 480, fail: retryable('acestep') }),
      fakeProvider('lyria'),
      onFallback,
    );

    const result = await router.generate(request());

    expect(result.servedBy).toBe('lyria');
    expect(result.fallbackReason).toBe('sem GPU');
    expect(onFallback).toHaveBeenCalledWith({ from: 'acestep', to: 'lyria', reason: 'sem GPU', kind: 'song' });
  });

  it('não esconde erro não retentável trocando de motor', async () => {
    const fallback = fakeProvider('lyria');
    const router = new MusicRouter(fakeProvider('acestep', { fail: fatal('acestep') }), fallback);

    await expect(router.generate(request())).rejects.toThrow('entrada inválida');
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it('música longa não tem reserva: o Lyria para em ~3 min', async () => {
    const fallback = fakeProvider('lyria', { maxDuration: 180 });
    const router = new MusicRouter(fakeProvider('acestep', { maxDuration: 480, fail: retryable('acestep') }), fallback);

    await expect(router.generate(request({ durationSeconds: 300 }))).rejects.toThrow('sem GPU');
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it('vai direto para quem suporta o tipo de geração', async () => {
    const primary = fakeProvider('acestep', { kinds: ['song'] });
    const router = new MusicRouter(primary, fakeProvider('lyria', { kinds: ['song', 'extend'] }));

    const result = await router.generate(request({ kind: 'extend' }));

    expect(result.servedBy).toBe('lyria');
    expect(primary.generate).not.toHaveBeenCalled();
  });

  it('recusa com clareza quando nenhum motor atende', async () => {
    const router = new MusicRouter(fakeProvider('acestep', { maxDuration: 480 }), null);

    await expect(router.generate(request({ durationSeconds: 600 }))).rejects.toThrow(/Nenhum motor atende 'song' com 600s/);
  });

  it('erro que não é MusicProviderError não escala para o motor pago', async () => {
    // Regressão de um caso real: FFMPEG_PATH vazio fez o motor mock lançar um
    // Error comum, e o roteador, tratando desconhecido como retentável, chamou
    // o Lyria — pagando por um erro de configuração nosso.
    const fallback = fakeProvider('lyria');
    const primary = fakeProvider('acestep', {
      fail: new Error("The argument 'file' cannot be empty. Received ''"),
    });
    const router = new MusicRouter(primary, fallback);

    await expect(router.generate(request())).rejects.toThrow('cannot be empty');
    expect(fallback.generate).not.toHaveBeenCalled();
  });
});
