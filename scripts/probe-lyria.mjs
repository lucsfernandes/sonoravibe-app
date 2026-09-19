#!/usr/bin/env node
/**
 * Sonda a API do Lyria 3 via OpenRouter.
 *
 * Por que existe: o Lyria 3 está em preview e a documentação pública da
 * OpenRouter não detalha o formato da resposta de áudio. Em vez de construir o
 * worker em cima de suposições, este script faz UMA chamada real, registra cada
 * evento do stream e salva o áudio — assim o provider é escrito contra o
 * comportamento observado.
 *
 * Descobertas confirmadas em teste real:
 *   - saída de áudio exige saldo mínimo de $0.50 na chave (senão HTTP 402)
 *   - saída de áudio exige `stream: true` (senão HTTP 400)
 *
 * Uso:
 *   node scripts/probe-lyria.mjs          (musica completa, ~$0.08)
 *   node scripts/probe-lyria.mjs --clip   (clipe de 30s, ~$0.04)
 *
 * A chave é lida do .env na raiz. Não precisa de dotenv nem de flag.
 */

import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

try {
  process.loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // Sem .env na raiz: segue com as variáveis já exportadas no shell.
}

const API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

if (!API_KEY) {
  console.error('Faltou OPENROUTER_API_KEY.');
  console.error('Defina no .env da raiz ou exporte no shell.');
  process.exit(1);
}

const useClip = process.argv.includes('--clip');
const model = useClip ? 'google/lyria-3-clip-preview' : 'google/lyria-3-pro-preview';

const prompt = useClip
  ? 'A short warm analog synth one-shot stab, 120 BPM, key of C minor, clean and punchy, no vocals.'
  : [
      'An instrumental synthwave track at 92 BPM.',
      'Warm analog synth pads and arpeggios, deep round sub bass, gated reverb drums.',
      'Nostalgic and cinematic, late-night driving mood.',
      'Strictly instrumental: no vocals, no singing, no spoken word.',
    ].join(' ');

const OUT_DIR = join(process.cwd(), 'tmp', 'probe');
mkdirSync(OUT_DIR, { recursive: true });
const EVENTS_PATH = join(OUT_DIR, 'events.jsonl');
writeFileSync(EVENTS_PATH, '');

/** Substitui payloads longos por um resumo, para o log ficar legível. */
function summarize(value) {
  if (typeof value === 'string') {
    return value.length > 100
      ? `<string ${value.length} chars: "${value.slice(0, 48)}...">`
      : value;
  }
  if (Array.isArray(value)) return value.map(summarize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarize(v)]));
  }
  return value;
}

/**
 * Varre um objeto procurando strings que pareçam áudio.
 * Devolve o caminho onde achou — é isso que o provider vai usar.
 */
function findAudioPaths(node, path = '$', out = []) {
  if (typeof node === 'string') {
    if (/^https?:\/\/\S+\.(wav|mp3|flac|ogg|m4a)/i.test(node)) {
      out.push({ path, type: 'url', value: node });
    } else if (node.startsWith('data:audio/')) {
      out.push({ path, type: 'data-uri', value: node });
    } else if (node.length > 200 && /^[A-Za-z0-9+/]+={0,2}$/.test(node)) {
      out.push({ path, type: 'base64', value: node });
    }
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => findAudioPaths(v, `${path}[${i}]`, out));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) findAudioPaths(v, `${path}.${k}`, out);
  }
  return out;
}

/** Descobre a extensão real pelos primeiros bytes do arquivo. */
function sniffExtension(buf) {
  if (buf.length < 12) return null;
  const a4 = buf.subarray(0, 4).toString('ascii');
  if (a4.startsWith('ID3')) return 'mp3';
  if (a4 === 'fLaC') return 'flac';
  if (a4 === 'OggS') return 'ogg';
  if (a4 === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

async function main() {
  console.log(`\nModelo:  ${model}`);
  console.log(`Prompt:  ${prompt}\n`);
  console.log('Chamando a OpenRouter com stream: true ...\n');

  const startedAt = Date.now();

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'https://sonora.app',
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'Sonora',
    },
    body: JSON.stringify({
      model,
      // Confirmado em teste: saída de áudio só funciona com stream ligado.
      stream: true,
      modalities: ['text', 'audio'],
      audio: { format: 'wav' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  console.log(`HTTP ${response.status} em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`content-type: ${response.headers.get('content-type')}\n`);

  if (!response.ok) {
    const raw = await response.text();
    console.error('A chamada falhou. Corpo da resposta:\n');
    console.error(raw.slice(0, 4000));
    writeFileSync(join(OUT_DIR, 'error.json'), raw);
    if (response.status === 402) {
      console.error(
        '\nSaldo insuficiente. A OpenRouter exige pelo menos $0.50 disponíveis\n' +
          'para saída de áudio. Ajuste o limite da chave em:\n' +
          '  https://openrouter.ai/settings/keys',
      );
    }
    process.exitCode = 1;
    return;
  }

  // --- Consome o SSE ---------------------------------------------------------
  const decoder = new TextDecoder();
  let buffer = '';
  let eventCount = 0;
  let textOut = '';
  /** Pedaços de áudio na ordem em que chegaram. */
  const audioChunks = [];
  /** Caminho no evento onde o áudio foi encontrado (primeiro acerto). */
  let audioPath = null;
  let audioFormat = null;
  let usage = null;
  let finishReason = null;
  const shapeSamples = [];

  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });

    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }

        eventCount++;
        appendFileSync(EVENTS_PATH, JSON.stringify(summarize(event)) + '\n');

        // Guarda os 3 primeiros eventos completos para inspeção de shape.
        if (shapeSamples.length < 3) shapeSamples.push(summarize(event));

        if (event.usage) usage = event.usage;
        const choice = event.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const delta = choice?.delta ?? choice?.message;
        if (!delta) continue;

        if (typeof delta.content === 'string') textOut += delta.content;

        const hits = findAudioPaths(delta, '$.choices[0].delta');
        for (const hit of hits) {
          if (!audioPath) {
            audioPath = hit.path;
            console.log(`Primeiro áudio visto em: ${hit.path} [${hit.type}]`);
          }
          audioChunks.push(hit);
        }
        if (!audioFormat) {
          audioFormat = delta.audio?.format ?? null;
        }

        if (eventCount % 25 === 0) {
          process.stdout.write(
            `\r  eventos: ${eventCount}  chunks de áudio: ${audioChunks.length}   `,
          );
        }
      }
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n\nStream encerrado em ${elapsed}s`);
  console.log(`  eventos recebidos: ${eventCount}`);
  console.log(`  chunks de áudio:   ${audioChunks.length}`);
  console.log(`  finish_reason:     ${finishReason ?? '(nenhum)'}`);
  if (textOut.trim()) console.log(`  texto:             ${textOut.trim().slice(0, 200)}`);
  if (usage) console.log(`  usage:             ${JSON.stringify(usage)}`);
  console.log(`\nEventos gravados em: ${EVENTS_PATH}`);

  if (shapeSamples.length) {
    console.log('\n=== Shape dos primeiros eventos ===');
    console.log(JSON.stringify(shapeSamples, null, 2));
  }

  if (audioChunks.length === 0) {
    console.warn(
      '\nNenhum áudio encontrado no stream.\n' +
        `Inspecione ${EVENTS_PATH} e me mande — ajusto o provider ao formato real.`,
    );
    process.exitCode = 1;
    return;
  }

  // --- Remonta o áudio -------------------------------------------------------
  // Os chunks podem ser (a) fragmentos de um único base64, ou (b) base64
  // independentes. Detectamos pelo padding: '=' no meio da sequência indica que
  // cada chunk se fecha sozinho e precisa ser decodificado separadamente.
  const values = audioChunks.map((c) =>
    c.type === 'data-uri' ? c.value.slice(c.value.indexOf(',') + 1) : c.value,
  );

  const hasInnerPadding = values
    .slice(0, -1)
    .some((v) => v.includes('='));

  let audio;
  if (hasInnerPadding) {
    console.log('\nChunks são base64 independentes — decodificando um a um.');
    audio = Buffer.concat(values.map((v) => Buffer.from(v, 'base64')));
  } else {
    console.log('\nChunks são fragmentos de um base64 único — concatenando antes de decodificar.');
    audio = Buffer.from(values.join(''), 'base64');
  }

  // O Lyria ignora o audio.format pedido, então a extensão vem dos magic bytes.
  // Confiar no formato solicitado gravaria um MP3 com extensão .wav.
  const ext = sniffExtension(audio) ?? (audioFormat ?? 'bin').replace(/^audio\//, '');
  const outPath = join(OUT_DIR, `lyria-${useClip ? 'clip' : 'pro'}.${ext}`);
  writeFileSync(outPath, audio);

  const header = audio.subarray(0, 4).toString('ascii');
  console.log(`\nÁudio salvo: ${outPath}`);
  console.log(`  tamanho:  ${(audio.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  header:   "${header}" ${header === 'RIFF' ? '(WAV válido)' : '(verificar)'}`);
  console.log(`  caminho no evento: ${audioPath}`);
  console.log('\nAbra o arquivo para conferir a qualidade.');
}

main().catch((err) => {
  console.error('\nErro inesperado:', err);
  process.exitCode = 1;
});
