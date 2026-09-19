/**
 * Smoke test do contrato TypeScript <-> worker GPU (Python), sem RunPod real.
 *
 * Pré-requisitos, em outros terminais:
 *   1. Worker atrás do emulador da RunPod (no ambiente do ACE-Step):
 *        python -m uv run --with runpod==1.12.0 python <repo>/apps/gpu-worker/handler.py \
 *          --rp_serve_api --rp_api_port 8008
 *   2. Um destino de upload: URL pré-assinada real do R2, ou um receptor local
 *      que aceite PUT com Content-Type audio/flac.
 *
 * Uso:
 *   ACESTEP_URL=http://127.0.0.1:8008 UPLOAD_URL=http://127.0.0.1:8765/upload/smoke.flac \
 *     pnpm exec tsx scripts/smoke-acestep.ts
 */
import { advancedControlsSchema } from '@sonora/shared';
import { AceStepProvider } from '../src/providers/acestep.provider';

const baseUrl = process.env.ACESTEP_URL ?? 'http://127.0.0.1:8008';
const uploadUrl = process.env.UPLOAD_URL ?? 'http://127.0.0.1:8765/upload/smoke.flac';
const local = baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost');

const provider = new AceStepProvider({
  baseUrl,
  apiKey: process.env.RUNPOD_API_KEY,
  // O emulador do SDK usa POST no /status e executa o job dentro dessa chamada.
  statusMethod: local ? 'POST' : 'GET',
  totalTimeoutMs: 15 * 60_000,
});

// O pacote é CommonJS (exigência do NestJS), então nada de await no topo do arquivo.
async function main(): Promise<void> {
  const startedAt = Date.now();
  const result = await provider.generate({
    kind: 'song',
    prompt: 'Brazilian pop rock, warm acoustic guitars, steady live drums',
    lyrics: '[Verse]\nVou seguir a estrada até o mar\n\n[Chorus]\nDeixar o vento decidir por mim',
    instrumental: false,
    durationSeconds: 30,
    controls: advancedControlsSchema.parse({ bpm: 104, key: 'G', vocalGender: 'male', excludeStyles: 'distortion' }),
    vocalLanguage: 'pt',
    seed: 7,
    uploadTarget: { url: uploadUrl, storageKey: 'smoke/master.flac', contentType: 'audio/flac' },
  });

  console.log(JSON.stringify({ elapsedS: Math.round((Date.now() - startedAt) / 1000), result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
