#!/usr/bin/env node
/**
 * Sonda o ACE-Step 1.5 rodando localmente (servidor compatível com OpenRouter).
 *
 * Objetivo: medir, em hardware real, o que decide se o ACE-Step entra no
 * produto para músicas acima de 3 minutos (o teto do Lyria):
 *   - tempo de geração de uma música longa em português, com letra
 *   - pico de VRAM durante a geração
 *   - formato, sample rate e bitrate do áudio devolvido
 *
 * Pré-requisito: servidor no ar em outro terminal
 *   cd D:/WSL/ACE-Step-1.5 && python -m uv run acestep-openrouter
 *
 * Uso:
 *   node scripts/probe-acestep.mjs                 (4min30, com letra)
 *   node scripts/probe-acestep.mjs --duration 60   (duração customizada)
 *   node scripts/probe-acestep.mjs --instrumental
 *   node scripts/probe-acestep.mjs --format wav    (ACE-Step entrega WAV float32 48 kHz nativo)
 *   node scripts/probe-acestep.mjs --thinking      (LM gera o esqueleto rítmico antes da difusão)
 *   node scripts/probe-acestep.mjs --auto-duration (duração decidida pela letra)
 *   node scripts/probe-acestep.mjs --steps 16      (mais passos de difusão)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';

const BASE_URL = process.env.ACESTEP_URL ?? 'http://127.0.0.1:8002';
/** Chave do servidor quando ele está exposto na internet (ex.: pod de teste na RunPod). */
const API_KEY = process.env.ACESTEP_API_KEY;
const AUTH_HEADERS = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
/** O amostrador de VRAM lê a GPU LOCAL; num servidor remoto ele mediria a máquina errada. */
const IS_LOCAL = ['127.0.0.1', 'localhost'].includes(new URL(BASE_URL).hostname);
/** Prefixo dos arquivos gerados, para não sobrescrever resultados de outro ambiente. */
const TAG = process.env.ACESTEP_TAG ? `${process.env.ACESTEP_TAG}-` : '';

const args = process.argv.slice(2);
const durationArg = args.indexOf('--duration');
const duration = durationArg >= 0 ? Number(args[durationArg + 1]) : 270;
const instrumental = args.includes('--instrumental');
const formatArg = args.indexOf('--format');
const format = formatArg >= 0 ? args[formatArg + 1] : 'mp3';
/** Liga o planejamento do LM (códigos semânticos que guiam ritmo e estrutura). */
const thinking = args.includes('--thinking');
/** Deixa o modelo decidir a duração pela letra, como a doc recomenda para música cantada. */
const autoDuration = args.includes('--auto-duration');
const stepsArg = args.indexOf('--steps');
const inferenceSteps = stepsArg >= 0 ? Number(args[stepsArg + 1]) : undefined;

/**
 * Teto para uma geração. Em CPU uma música de 4min30 levou 8min50s.
 * O fetch do Node desiste após 5 min sem cabeçalhos (headersTimeout do undici),
 * o que derrubou o primeiro teste em CPU — por isso usamos http.request.
 */
const GENERATION_TIMEOUT_MS = 30 * 60 * 1000;

const OUT_DIR = join(process.cwd(), 'tmp', 'probe');
mkdirSync(OUT_DIR, { recursive: true });

// Letra original, escrita para este teste. Estrutura longa o bastante para 4min30.
const LYRICS = `[Intro]

[Verse 1]
Acordei com o sol batendo na janela
A cidade ainda dorme lá fora
Um café, um silêncio, uma vela
E a vontade de ir embora

[Pre-Chorus]
Mas alguma coisa me segura aqui
Um motivo que eu ainda não entendi

[Chorus]
Vou seguir a estrada até o mar
Deixar o vento decidir por mim
Se a vida é feita pra se arriscar
Eu quero ver onde isso tem fim

[Verse 2]
Tem um rádio tocando uma canção antiga
Que meu pai cantava sem saber a letra
Cada esquina guarda uma cantiga
Cada passo desenha uma linha reta

[Pre-Chorus]
Mas alguma coisa me segura aqui
Um motivo que eu ainda não entendi

[Chorus]
Vou seguir a estrada até o mar
Deixar o vento decidir por mim
Se a vida é feita pra se arriscar
Eu quero ver onde isso tem fim

[Bridge]
E se eu voltar, que seja inteiro
Com poeira no sapato e luz no olhar
Quem parte cedo chega primeiro
No lugar que ninguém sabe achar

[Guitar Solo]

[Chorus]
Vou seguir a estrada até o mar
Deixar o vento decidir por mim
Se a vida é feita pra se arriscar
Eu quero ver onde isso tem fim

[Outro]
Até o mar, até o fim`;

const STYLE =
  'Brazilian pop rock, warm acoustic and electric guitars, steady live drums, ' +
  'melodic bass, male vocal, uplifting and nostalgic, road trip feeling, 104 BPM';

/** Amostra o uso de VRAM a cada 500ms para registrar o pico. */
function startVramSampler() {
  let peak = 0;
  let baseline = null;
  const timer = setInterval(() => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
      (err, stdout) => {
        if (err) return;
        const used = Number(stdout.trim().split('\n')[0]);
        if (Number.isFinite(used)) {
          if (baseline === null) baseline = used;
          peak = Math.max(peak, used);
        }
      },
    );
  }, 500);
  return {
    stop() {
      clearInterval(timer);
      return { peakMiB: peak, baselineMiB: baseline };
    },
  };
}

/** POST JSON sem o limite implícito de 5 min do fetch. */
function postJson(url, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...AUTH_HEADERS },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`Sem resposta após ${timeoutMs / 60000} min`)),
    );
    req.on('error', reject);
    req.end(body);
  });
}

function sniffExtension(buf) {
  const a4 = buf.subarray(0, 4).toString('ascii');
  if (a4.startsWith('ID3')) return 'mp3';
  if (a4 === 'fLaC') return 'flac';
  if (a4 === 'OggS') return 'ogg';
  if (a4 === 'RIFF') return 'wav';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  return 'bin';
}

async function main() {
  const health = await fetch(`${BASE_URL}/health`, { headers: AUTH_HEADERS }).catch(() => null);
  if (!health?.ok) {
    console.error(`Servidor ACE-Step não responde em ${BASE_URL}/health.`);
    console.error('Suba antes em outro terminal:');
    console.error('  cd D:/WSL/ACE-Step-1.5 && python -m uv run acestep-openrouter');
    process.exitCode = 1;
    return;
  }

  const models = await fetch(`${BASE_URL}/v1/models`, { headers: AUTH_HEADERS }).then((r) => r.json()).catch(() => null);
  const modelId = models?.data?.[0]?.id;

  console.log(`\nModelo:       ${modelId ?? '(auto)'}`);
  console.log(`Duração:      ${autoDuration ? 'automática (pela letra)' : `${duration}s (${(duration / 60).toFixed(1)} min)`}`);
  console.log(`Thinking:     ${thinking ? 'ligado' : 'desligado'}${inferenceSteps ? `  |  passos: ${inferenceSteps}` : ''}`);
  console.log(`Modo:         ${instrumental ? 'instrumental' : 'com letra em português'}`);
  console.log('\nGerando... (a primeira chamada inclui aquecimento do modelo)\n');

  const content = instrumental
    ? `<prompt>${STYLE.replace('male vocal, ', '')}</prompt>`
    : `<prompt>${STYLE}</prompt>\n<lyrics>${LYRICS}</lyrics>`;

  const vram = IS_LOCAL ? startVramSampler() : { stop: () => ({ peakMiB: 0, baselineMiB: null }) };
  const startedAt = Date.now();

  let response;
  let peakMiB = 0;
  let baselineMiB = null;
  try {
    response = await postJson(
      `${BASE_URL}/v1/chat/completions`,
      {
        model: modelId,
        messages: [{ role: 'user', content }],
        ...(thinking ? { thinking: true } : {}),
        ...(inferenceSteps ? { inference_steps: inferenceSteps } : {}),
        audio_config: {
          ...(autoDuration ? {} : { duration }),
          vocal_language: 'pt',
          instrumental,
          bpm: 104,
          format,
        },
        // Seed fixa: reexecuções no MESMO hardware produzem a mesma música.
        // GPU e CPU divergem mesmo com a mesma seed (diferenças de ponto flutuante).
        seed: 42,
      },
      GENERATION_TIMEOUT_MS,
    );
  } finally {
    // Sem isso o setInterval do amostrador mantém o processo vivo após um erro.
    ({ peakMiB, baselineMiB } = vram.stop());
  }

  const elapsed = (Date.now() - startedAt) / 1000;

  console.log(`HTTP ${response.status} em ${elapsed.toFixed(1)}s`);
  if (baselineMiB !== null) {
    console.log(`VRAM: pico ${peakMiB} MiB (antes da chamada: ${baselineMiB} MiB)`);
  }

  const raw = response.body;
  if (!response.ok) {
    console.error('\nFalhou:\n', raw.slice(0, 3000));
    writeFileSync(join(OUT_DIR, 'acestep-error.json'), raw);
    process.exitCode = 1;
    return;
  }

  const body = JSON.parse(raw);
  const message = body.choices?.[0]?.message;
  const url = message?.audio?.[0]?.audio_url?.url;

  if (!url) {
    console.error('\nResposta sem áudio. Estrutura:', Object.keys(message ?? {}));
    writeFileSync(join(OUT_DIR, 'acestep-response.json'), raw);
    process.exitCode = 1;
    return;
  }

  const audio = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const ext = sniffExtension(audio);
  const label = instrumental ? 'instrumental' : 'pt';
  const variant = [
    autoDuration ? 'auto' : `${duration}s`,
    thinking ? 'think' : 'base',
    inferenceSteps ? `${inferenceSteps}steps` : null,
    format,
  ].filter(Boolean).join('-');
  const outPath = join(OUT_DIR, `${TAG}acestep-${label}-${variant}.${ext}`);
  writeFileSync(outPath, audio);

  // Duração real medida no arquivo: com --auto-duration ela não é conhecida antes.
  const actualDuration = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath])
      .toString()
      .trim(),
  );
  const realtimeFactor = actualDuration / elapsed;
  console.log(`\nÁudio salvo: ${outPath}`);
  console.log(`  tamanho:  ${(audio.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  formato:  ${ext}`);
  console.log(
    `  velocidade: ${realtimeFactor.toFixed(1)}x tempo real ` +
      `(${elapsed.toFixed(1)}s para ${actualDuration.toFixed(0)}s de música)`,
  );

  if (typeof message.content === 'string' && message.content.trim()) {
    console.log('\n=== Metadados devolvidos pelo LM ===');
    console.log(message.content.slice(0, 800));
  }
}

main().catch((err) => {
  console.error('\nErro inesperado:', err);
  process.exitCode = 1;
});
