#!/usr/bin/env node
/**
 * Envia uma pasta de músicas para o bucket privado de datasets de LoRA.
 *
 * Uso:  node scripts/lora/subir-dataset.mjs <pasta-local> <estilo> --tenho-direitos [--simular]
 *
 * Só o áudio é obrigatório (mp3, wav, flac, ogg, opus). Letra, BPM, tom e
 * caption são gerados no pod de treino (rotulagem do próprio ACE-Step). Um
 * `{nome}.lyrics.txt` ao lado do áudio, se existir, vai junto e vale mais que a
 * transcrição.
 *
 * `--tenho-direitos` é a confirmação de que as faixas NÃO vêm do Suno nem de
 * outro serviço que proíba treino de IA; ela fica gravada no manifesto.
 * `--simular` só confere a pasta, sem enviar nada.
 * `--substituir` apaga antes tudo o que houver em lora/<estilo>/ no bucket (áudio,
 * rótulos e adapters), para trocar o dataset por outro.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { AUDIO_EXT, BUCKET, assertConfig, checkBucket, put, removePrefix, slug } from './r2.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [dir, styleArg] = args.filter((a) => !a.startsWith('--'));

if (!dir || !styleArg) {
  console.error('Uso: node scripts/lora/subir-dataset.mjs <pasta-local> <estilo> --tenho-direitos [--simular] [--substituir]');
  process.exit(1);
}
if (!flags.has('--tenho-direitos')) {
  console.error(
    'Falta --tenho-direitos: confirme que as faixas não vêm do Suno nem de serviço que proíba treino de IA\n' +
      '(os termos do Suno vetam usar as saídas para treinar outros modelos).',
  );
  process.exit(1);
}

const style = slug(styleArg);
const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/opus' };
// Percorre subpastas (artista/álbum/...). No bucket tudo fica numa pasta só, com o
// caminho no nome (`artista__album__faixa.mp3`): duas faixas "01.mp3" de álbuns
// diferentes não se sobrescrevem, e a origem de cada uma continua legível.
function walk(base, rel = '') {
  return readdirSync(join(base, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.name.startsWith('.')) return [];
    return e.isDirectory() ? walk(base, r) : [r];
  });
}
const safe = (part) =>
  part.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const files = new Set(walk(dir));
const audios = [...files].filter((f) => AUDIO_EXT.test(f)).sort();

if (audios.length === 0) {
  console.error(`Nenhum áudio (mp3, wav, flac, ogg, opus) em ${dir} nem nas subpastas.`);
  process.exit(1);
}

const tracks = audios.map((rel) => {
  const ext = extname(rel);
  const relStem = rel.slice(0, -ext.length);
  const lyricsFile = [`${relStem}.lyrics.txt`, `${relStem}.txt`].find((x) => files.has(x)) ?? null;
  const stem = relStem.split('/').map(safe).join('__');
  return { rel, file: `${stem}${ext.toLowerCase()}`, stem, size: statSync(join(dir, rel)).size, lyricsFile, group: rel.includes('/') ? rel.split('/')[0] : '(raiz)' };
});

const stems = new Set();
for (const t of tracks) {
  if (stems.has(t.stem)) {
    console.error(`Duas faixas viram o mesmo nome '${t.stem}': renomeie uma delas.`);
    process.exit(1);
  }
  stems.add(t.stem);
}

const groups = Object.entries(tracks.reduce((acc, t) => ((acc[t.group] = (acc[t.group] ?? 0) + 1), acc), {}));
if (groups.length > 1) {
  console.log(`Pastas de 1º nível: ${groups.map(([g, n]) => `${g} (${n})`).join(', ')}`);
  console.log('Lembrete: um LoRA aprende o que as faixas têm EM COMUM. Artistas de estilos diferentes num só estilo diluem o resultado.');
}
const totalMb = tracks.reduce((s, t) => s + t.size, 0) / 1024 / 1024;
console.log(`Estilo '${style}': ${tracks.length} faixa(s), ${totalMb.toFixed(1)} MB; ${tracks.filter((t) => t.lyricsFile).length} com letra.`);
if (tracks.length < 8) {
  console.log(`Aviso: ${tracks.length} faixa(s). O tutorial do ACE-Step recomenda de 10 a 20 por estilo (serve para testar o fluxo).`);
}

if (flags.has('--simular')) {
  for (const t of tracks) console.log(`  ${t.rel}  ->  ${t.file}${t.lyricsFile ? `  (+ letra)` : ''}`);
  console.log('Simulação: nada foi enviado.');
  process.exit(0);
}

assertConfig();
await checkBucket();

if (flags.has('--substituir')) {
  const removed = await removePrefix(`lora/${style}/`);
  console.log(`--substituir: ${removed} arquivo(s) antigos de lora/${style}/ apagados.`);
}

const prefix = `lora/${style}/audio`;
for (const [i, t] of tracks.entries()) {
  process.stdout.write(`[${i + 1}/${tracks.length}] ${t.rel} ... `);
  await put(`${prefix}/${t.file}`, readFileSync(join(dir, t.rel)), MIME[extname(t.file)]);
  // O ACE-Step lê a letra de `{nome}.lyrics.txt` ao lado do áudio.
  if (t.lyricsFile) await put(`${prefix}/${t.stem}.lyrics.txt`, readFileSync(join(dir, t.lyricsFile)), 'text/plain; charset=utf-8');
  console.log('ok');
}

const manifest = {
  style,
  uploadedAt: new Date().toISOString(),
  rightsConfirmed: true,
  rightsNote: 'Confirmado com --tenho-direitos: faixas sem origem no Suno nem em serviço que proíba treino de IA.',
  tracks: tracks.map(({ rel, file, size, lyricsFile }) => ({ origem: rel, file, size, lyrics: Boolean(lyricsFile) })),
};
await put(`lora/${style}/manifesto.json`, JSON.stringify(manifest, null, 2), 'application/json');
console.log(`Pronto: ${tracks.length} faixa(s) em ${BUCKET}/lora/${style}/. Próximo: node scripts/lora/treinar-lora.mjs ${style} --so-rotular`);
