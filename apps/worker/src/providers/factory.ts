import type { MusicProvider } from '@sonora/shared';
import type { WorkerConfig } from '../config';
import { AceStepProvider } from './acestep.provider';
import { LyriaProvider } from './lyria.provider';
import { MockMusicProvider } from './mock.provider';
import { MusicRouter, type FallbackEvent } from './music-router';

/**
 * Monta o roteador de motores a partir da configuração.
 *
 * O motor principal é escolhido por `MUSIC_PROVIDER`; o Lyria entra como
 * reserva automática sempre que houver chave do OpenRouter e ele não for já o
 * principal. Em desenvolvimento, `mock` gera áudio com FFmpeg, sem GPU e sem
 * custo — é o que permite testar o fluxo inteiro sem gastar um centavo.
 */
export function buildMusicRouter(
  config: WorkerConfig,
  onFallback: (event: FallbackEvent) => void = () => {},
): MusicRouter {
  const primary = buildPrimary(config);
  const fallback =
    config.MUSIC_PROVIDER !== 'lyria' && config.OPENROUTER_API_KEY
      ? buildLyria(config)
      : null;

  return new MusicRouter(primary, fallback, onFallback);
}

function buildPrimary(config: WorkerConfig): MusicProvider {
  switch (config.MUSIC_PROVIDER) {
    case 'acestep':
      return new AceStepProvider({
        baseUrl:
          config.RUNPOD_BASE_URL ?? `https://api.runpod.ai/v2/${config.RUNPOD_ENDPOINT_ID}`,
        apiKey: config.RUNPOD_API_KEY,
        // O emulador local do SDK responde /status em POST; a RunPod, em GET.
        statusMethod: config.RUNPOD_BASE_URL ? 'POST' : 'GET',
      });
    case 'lyria':
      return buildLyria(config);
    case 'mock':
      return new MockMusicProvider(config.FFMPEG_PATH);
  }
}

function buildLyria(config: WorkerConfig): MusicProvider {
  if (!config.OPENROUTER_API_KEY) {
    throw new Error('Lyria exige OPENROUTER_API_KEY.');
  }
  return new LyriaProvider({
    apiKey: config.OPENROUTER_API_KEY,
    baseUrl: config.OPENROUTER_BASE_URL,
    proModel: config.OPENROUTER_MUSIC_MODEL,
    clipModel: config.OPENROUTER_CLIP_MODEL,
    siteUrl: config.OPENROUTER_SITE_URL,
    appName: config.OPENROUTER_APP_NAME,
  });
}
