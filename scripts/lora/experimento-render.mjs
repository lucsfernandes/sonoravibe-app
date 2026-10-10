#!/usr/bin/env node
/**
 * Experimento de validação do render (docs: plano da rodada 3 do eletronics, seção 3):
 * os MESMOS códigos do LM renderizados de jeitos diferentes, para separar o que é do
 * plano do LM (estrutura) do que é do DiT (render), e o que é do adapter do que é sorteio.
 *
 * Por que códigos fixos: o seed não chega ao LM (backend vllm), então duas faixas com
 * "mesma seed" têm estruturas diferentes. Aqui os códigos de cada faixa de origem são
 * extraídos LOCALMENTE dos group-*.log da rodada 3 (linha `Debug output text: <|audio_code…`
 * casada com o `[bench] <label>: ok` seguinte) e injetados pelo bench_run.py
 * (`_bench_audio_codes`). Com bpm, keyscale, duração e timesignature fixados, o LM não
 * sorteia nada: nem a fase 1 (metas) nem a fase 2 (códigos).
 *
 * Um pod L4, três processos do handler REAL (apps/gpu-worker/handler.py) em sequência:
 *   A   XL-SFT sem adapter: S1 (sanidade), S2–S8 com códigos fixos, S9–S12 com LM livre (lote 2)
 *   B1  XL-turbo sem adapter carregado: T_base (sanidade) e os planos do SFT no turbo
 *   B2  XL-turbo com o LoKr eletronics turbo carregado: toggle e grade pareada de forças
 * Os dois XL cabem no disco do pod (o benchmark-qualidade.mjs "24" já baixou os dois em
 * 120 GB): o XL-turbo baixa em segundo plano enquanto o processo A roda.
 *
 * Uso:
 *   node scripts/lora/experimento-render.mjs [--simular]
 *   opções: --processos=A,B1,B2        quais processos rodar
 *           --adapter=<data>           pasta em lora/eletronics/adapters/ (padrão: a da rodada turbo)
 *           --rodada-sft=<pasta>       origem dos códigos SFT (padrão: a rodada 3)
 *           --rodada-turbo=<pasta>     origem dos códigos turbo (padrão: a rodada 3)
 *           --python=<exe>             python com numpy e soundfile, para comparar ondas
 *           --gpu-qualquer             aceita outra GPU de 24 GB se não houver L4 (S1 e B1 deixam de valer)
 *           --max-min=75               teto do pod inteiro
 *           --simular                  mostra os braços e o custo estimado, sem criar pod
 *
 * Interface do bench_run.py (por job, em `input`, retirada antes de chamar o handler):
 *   _bench_audio_codes  string "<|audio_code_N|>…" que substitui GenerationParams.audio_codes
 *   _bench_overrides    dict mesclado no retorno do _model_settings real (guidance_scale,
 *                       cfg_interval_start/end, lm_cfg_scale, lm_temperature, timesignature)
 *   results/<label>.json ganha `audio_codes` (os códigos que de fato renderizaram)
 *
 * Saída: docs/benchmarks/experimento-render/<data>/ com audio/faixa-NN.flac (nomes
 * sorteados), escuta.md (o que pontuar), gabarito.json (o mapa e as verificações) e
 * resultados/ (JSON de cada job e os logs dos processos).
 *
 * O pod é SEMPRE destruído: em sucesso, erro, Ctrl+C, no teto ou se a sanidade S1 falhar.
 * Ele nunca recebe credenciais do R2, só a URL assinada do adapter.
 */
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${def}`).split('=')[1];
const SIMULATE = args.includes('--simular');
const MAX_MIN = Number(opt('max-min', 75));
const PROCESSES = opt('processos', 'A,B1,B2').split(',').filter(Boolean);
if (PROCESSES.length === 0 || PROCESSES.some((p) => !['A', 'B1', 'B2'].includes(p))) {
  console.error('--processos: lista de A, B1 e B2 (ex.: --processos=B1,B2).');
  process.exit(1);
}
const RUN_SFT = opt('rodada-sft', join('docs', 'benchmarks', 'lora-eletronics', '2026-10-02T10-01-06-sft'));
const RUN_TURBO = opt('rodada-turbo', join('docs', 'benchmarks', 'lora-eletronics', '2026-10-02T10-01-07-turbo'));
// O adapter da grade B2 é o mesmo que a rodada turbo testou: a pasta da rodada tem o nome dele.
const ADAPTER_STAMP = opt('adapter', basename(RUN_TURBO));
const STYLE = 'eletronics';
const LOCAL_ACE_PY = '/mnt/d/WSL/ACE-Step-1.5/.venv/Scripts/python.exe'; // a venv local do ACE-Step, se existir
const PYTHON = opt('python', process.env.EXPERIMENTO_PYTHON || (existsSync(LOCAL_ACE_PY) ? LOCAL_ACE_PY : 'python3'));

try {
  process.loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // segue com o ambiente do shell
}
const RUNPOD_KEY = process.env.RUNPOD_API_KEY;
if (!RUNPOD_KEY && !SIMULATE) {
  console.error('Faltou RUNPOD_API_KEY no .env.');
  process.exit(1);
}

// O mesmo digest do apps/gpu-worker/Dockerfile e das rodadas de origem dos códigos.
const IMAGE = 'ghcr.io/ace-step/ace-step-1.5@sha256:95652cd780c78a1b1a7f6f0335530430f0ae53d96c7c12d59f9f39fa23d38567';
// Só L4: a rodada de origem rodou numa L4, e S1/B1 comparam a onda com a original. Outra
// GPU muda as formas dos GEMMs e a comparação deixa de dizer se a injeção funcionou.
// Em 02/10/2026 o estoque de L4 na Secure Cloud estava "Low": três pods foram criados e nunca
// ganharam máquina. --gpu-qualquer tira a L4 da lista (a A40, estoque "Medium", vem primeiro) e
// a onda de S1/B1 vira só informativa; a prova da injeção passa a ser o log (infer_type=dit).
const ANY_GPU = args.includes('--gpu-qualquer');
const GPUS = ANY_GPU
  ? ['NVIDIA A40', 'NVIDIA RTX A6000', 'NVIDIA GeForce RTX 4090', 'NVIDIA RTX A5000', 'NVIDIA GeForce RTX 3090']
  : ['NVIDIA L4'];
const REST = 'https://rest.runpod.io/v1';
const DIT_SFT = 'acestep-v15-xl-sft';
const DIT_TURBO = 'acestep-v15-xl-turbo';
const SEED = 42;

const t0 = Date.now();
const log = (msg) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(5)}s] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`ERRO: ${msg}`);
  process.exit(1);
};

// --- Códigos de origem, extraídos dos logs da rodada 3 ---------------------------

/**
 * Os blocos de um group-*.log: as linhas de cada job, do `[bench]` anterior até o
 * `[bench] <label>: ok|ERRO em …` dele. O cabeçalho `[bench] <grupo>: modelos carregados`
 * e a linha de erro só fecham o bloco, sem rótulo.
 */
function logBlocks(text) {
  const blocks = [];
  let lines = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('[bench] ')) {
      const m = line.match(/^\[bench\] (\S+): (ok|ERRO) em /);
      if (m) blocks.push({ label: m[1], ok: m[2] === 'ok', lines });
      lines = [];
      continue;
    }
    lines.push(line);
  }
  return blocks;
}

const CODE_LINE = 'Debug output text: <|audio_code';
const codeTokens = (s) => String(s ?? '').match(/<\|audio_code_\d+\|>/g) ?? [];

/**
 * Os códigos de UMA faixa de uma rodada. Falha alto se o rótulo não estiver em
 * exatamente um log, se o bloco não tiver exatamente uma linha de códigos (a fase 2
 * imprime a saída inteira numa linha, em DEBUG) ou se a contagem não bater com a
 * duração (5 códigos por segundo) e com o `Generated N audio codes` do próprio log.
 */
function extractCodes(runDir, label, duration) {
  const dir = join(runDir, 'resultados');
  if (!existsSync(dir)) fail(`${dir} não existe: a rodada de origem precisa estar baixada.`);
  const found = [];
  for (const f of readdirSync(dir).filter((n) => /^group-.*\.log$/.test(n))) {
    for (const b of logBlocks(readFileSync(join(dir, f), 'utf8'))) {
      if (b.label === label) found.push({ file: f, ...b });
    }
  }
  if (found.length !== 1) fail(`${runDir}: '${label}' aparece ${found.length} vez(es) nos group-*.log (esperado 1).`);
  const [b] = found;
  if (!b.ok) fail(`${join(dir, b.file)}: '${label}' terminou em ERRO; não há código para reaproveitar.`);
  const seqs = b.lines.filter((l) => l.includes(CODE_LINE)).map(codeTokens);
  if (seqs.length !== 1) {
    fail(
      `${join(dir, b.file)}: '${label}' tem ${seqs.length} sequência(s) de códigos (esperado 1). ` +
        'O log precisa estar em nível DEBUG, e o job em lote 1.',
    );
  }
  const tokens = seqs[0];
  const logged = b.lines.map((l) => l.match(/Generated (\d+) audio codes/)).filter(Boolean).map((m) => Number(m[1]));
  if (tokens.length !== duration * 5 || (logged.length && logged.at(-1) !== tokens.length)) {
    fail(
      `${join(dir, b.file)}: '${label}' tem ${tokens.length} códigos; a duração de ${duration} s pede ${duration * 5}` +
        (logged.length ? ` e o log diz ${logged.at(-1)}.` : '.'),
    );
  }
  return tokens.join('');
}

function readResult(runDir, label) {
  const file = join(runDir, 'resultados', `${label}.json`);
  if (!existsSync(file)) fail(`Faltou ${file}.`);
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (!r.ok) fail(`${file}: o job de origem falhou.`);
  return r;
}

// T_good/T_base/S_bad/T_ctl/S_ctl são os do plano; os demais são o 2º sorteio de cada prompt da grade B2.
const SOURCES = {
  T_good: { run: RUN_TURBO, label: 'pista--final--s050', what: 'turbo pista--final--s050 (a melhor pista da rodada)' },
  T_base: { run: RUN_TURBO, label: 'pista--base', what: 'turbo pista--base' },
  S_bad: { run: RUN_SFT, label: 'pista--base', what: 'SFT pista--base (reprovada)' },
  T_ctl: { run: RUN_TURBO, label: 'controle--base', what: 'turbo controle--base (jazz)' },
  S_ctl: { run: RUN_SFT, label: 'controle--base', what: 'SFT controle--base (jazz, reprovada)' },
  T_pista2: { run: RUN_TURBO, label: 'pista-cfg6--base', what: 'turbo pista-cfg6--base (réplica de pista: 2º sorteio)' },
  T_ctl2: { run: RUN_TURBO, label: 'controle--final--s050', what: 'turbo controle--final--s050 (2º sorteio)' },
  T_voc: { run: RUN_TURBO, label: 'vocal--base', what: 'turbo vocal--base' },
  T_voc2: { run: RUN_TURBO, label: 'vocal--final--s050', what: 'turbo vocal--final--s050 (2º sorteio)' },
};
for (const [key, s] of Object.entries(SOURCES)) {
  const r = readResult(s.run, s.label);
  s.input = r.input;
  s.gpu = r.worker_info?.gpu;
  // timesignature é a 4ª meta: sem ela a fase 1 do LM roda e pode sortear outro valor.
  // Vem da SAÍDA do job de origem (o SFT controle--base escolheu "2", não "4").
  s.timesignature = r.output?.metadata?.timesignature;
  if (!s.timesignature) fail(`${s.run}: '${s.label}' não registrou timesignature em output.metadata.`);
  for (const k of ['bpm', 'keyscale', 'duration']) {
    if (s.input[k] == null || s.input[k] === '') fail(`${s.run}: '${s.label}' não fixou '${k}': o LM sortearia de novo.`);
  }
  if (s.input.seed !== SEED || (s.input.batch_size ?? 1) !== 1) fail(`${s.run}: '${s.label}' não é seed ${SEED} em lote 1.`);
  s.codes = extractCodes(s.run, s.label, s.input.duration);
  s.key = key;
}

// --- Entradas dos jobs -------------------------------------------------------------

// Só o pedido musical da origem: lora/lora_scale/model_family/passos são decididos pelo braço.
const MUSIC_FIELDS = ['task_type', 'caption', 'lyrics', 'bpm', 'keyscale', 'vocal_language', 'instrumental', 'duration', 'seed', 'style_influence', 'variety', 'cot_caption', 'negative_caption'];
const PROFILE = {
  sft: { model_family: 'sft', inference_steps: 50 }, // v2.5
  turbo: { model_family: 'turbo' }, // v1.5 (o cot_caption=false vem da origem)
};

function musicInput(src, family) {
  const base = Object.fromEntries(MUSIC_FIELDS.filter((k) => k in src.input).map((k) => [k, src.input[k]]));
  return { ...base, ...PROFILE[family], batch_size: 1 };
}

/** Um job com os códigos de `src` fixos: metas da origem (inclusive timesignature) e overrides do braço. */
function fixedJob(src, family, { input = {}, overrides = {} } = {}) {
  return {
    ...musicInput(src, family),
    ...input,
    _bench_audio_codes: src.codes,
    _bench_overrides: { timesignature: src.timesignature, ...overrides },
  };
}

// Réplica do buildJobInput (apps/worker/src/providers/acestep.provider.ts) para uma
// música nova instrumental, com o pedido como o generation.processor.ts monta (controles
// nos defaults do advancedControlsSchema). Funções copiadas de prompt-compiler.ts.
const VOCAL_EXCLUSION_TERMS = ['vocal', 'vocals', 'voice', 'voz', 'vocais', 'singing', 'canto', 'singer', 'cantor', 'lyrics', 'letra'];
function excludesVocals(excludeStyles) {
  if (!excludeStyles) return false;
  const items = excludeStyles.toLowerCase().split(/[,;\n]/).map((s) => s.trim().replace(/^(no|sem|without|avoid)\s+/, ''));
  return items.some((item) => VOCAL_EXCLUSION_TERMS.some((term) => item === term || item.startsWith(`${term} `)));
}
function compileAceStepCaption({ styles, excludeStyles, instrumental, controls }) {
  const parts = [];
  const s = styles?.trim();
  if (s) parts.push(s.replace(/[.\s]+$/, ''));
  if (!(instrumental || excludesVocals(excludeStyles)) && controls.vocalGender !== 'any') parts.push(`${controls.vocalGender} vocal`);
  if (controls.weirdness >= 80) parts.push('experimental, unconventional structure');
  else if (controls.weirdness <= 20) parts.push('conventional song structure');
  const caption = parts.join(', ').replace(/\s+/g, ' ').trim();
  return caption.length <= 512 ? caption : caption.slice(0, 512).replace(/,[^,]*$/, '');
}
function buildAceStepNegative(excludeStyles) {
  if (!excludeStyles?.trim()) return undefined;
  const items = excludeStyles
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase().replace(/^(no|sem|without|avoid)\s+/i, ''))
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .filter((item) => !excludesVocals(item));
  if (items.length === 0) return undefined;
  const negative = items.join(', ');
  return negative.length <= 512 ? negative : negative.slice(0, 512).replace(/,[^,]*$/, '');
}
const toAceStepKeyscale = (key) => (!key || key === 'any' ? undefined : `${key.endsWith('m') ? key.slice(0, -1) : key} ${key.endsWith('m') ? 'minor' : 'major'}`);
const MUSIC_MODEL_SPECS = { 'v2.0': { family: 'sft', steps: 32, cotCaption: false }, 'v2.5': { family: 'sft', steps: 50, cotCaption: false } };

function productionInput({ model, styles, durationSeconds, variants }) {
  const controls = { styles, vocalGender: 'any', maxMode: false, weirdness: 50, styleInfluence: 50, variety: 'high', personalize: false, key: 'any', durationSeconds };
  const req = { kind: 'song', model, prompt: styles, lyrics: null, instrumental: true, durationSeconds, controls, seed: undefined };
  const instrumental = req.instrumental || excludesVocals(req.controls.excludeStyles);
  const caption =
    compileAceStepCaption({ styles: req.prompt, excludeStyles: req.controls.excludeStyles, instrumental: req.instrumental, controls: req.controls }) ||
    (instrumental ? 'instrumental music' : 'song');
  const spec = MUSIC_MODEL_SPECS[model];
  return {
    task_type: 'text2music',
    model_family: spec.family,
    ...(spec.family === 'sft' ? { inference_steps: spec.steps } : {}),
    cot_caption: spec.cotCaption,
    caption,
    negative_caption: buildAceStepNegative(req.controls.excludeStyles) ?? null,
    lyrics: instrumental ? '' : (req.lyrics ?? ''),
    instrumental,
    duration: req.durationSeconds ?? null,
    bpm: req.controls.bpm ?? null,
    keyscale: toAceStepKeyscale(req.controls.key) ?? null,
    vocal_language: req.vocalLanguage ?? 'unknown',
    // Produção manda seed null (sorteio). Aqui 42, para a faixa ser reproduzível: o seed só
    // fixa o ruído do DiT, não muda o formato do pedido nem o LM.
    seed: req.seed ?? SEED,
    style_influence: req.controls.styleInfluence,
    variety: req.controls.variety,
    batch_size: variants,
    src_audio_url: null,
    repainting_start: 0,
    repainting_end: -1,
  };
}

// --- Os braços -----------------------------------------------------------------------

const S = SOURCES;
const SECTION_TAGS = '[Intro]\n\n[Build-up]\n\n[Drop]\n\n[Breakdown]\n\n[Outro]';
const warmup = (family) => ({ ...musicInput(S.T_base, family), duration: 10 });

const groups = {};
if (PROCESSES.includes('A')) {
  const tested = musicInput(S.S_bad, 'sft'); // o pedido da rodada (pista, bpm/key fixos, 90 s)
  groups.A = {
    dit: DIT_SFT,
    adapter: false,
    jobs: [
      { label: 'W-A', arm: 'aquecimento', input: warmup('sft') },
      { label: 'A-S1', arm: 'S1', codes: 'S_bad', sanity: { against: 'original', run: RUN_SFT, file: 'pista--base-0.flac' },
        description: 'SANIDADE: os códigos da SFT pista--base no próprio SFT. Tem de sair igual ao FLAC original.', input: fixedJob(S.S_bad, 'sft') },
      { label: 'A-S2', arm: 'S2', codes: 'T_good', description: 'plano bom do turbo, perfil SFT atual (CFG 7, [instrumental])', input: fixedJob(S.T_good, 'sft') },
      { label: 'A-S3', arm: 'S3', codes: 'T_base', description: '2ª amostra de plano turbo, perfil SFT atual', input: fixedJob(S.T_base, 'sft') },
      { label: 'A-S8', arm: 'S8', codes: 'T_ctl', description: 'plano turbo do jazz, perfil SFT atual', input: fixedJob(S.T_ctl, 'sft') },
      { label: 'A-S4', arm: 'S4', codes: 'T_good', description: 'CFG 3', input: fixedJob(S.T_good, 'sft', { overrides: { guidance_scale: 3.0 } }) },
      // cfg_interval compara com o VALOR de t (1 = ruído, 0 = limpo): end 0,5 desliga o CFG
      // nos passos ruidosos (t > 0,5; ~37 dos 50 com shift 3) e o deixa só no fim.
      { label: 'A-S5', arm: 'S5', codes: 'T_good', description: 'CFG 7 só com t ≤ 0,5 (cfg_interval_end 0,5: sem CFG nos passos ruidosos)',
        input: fixedJob(S.T_good, 'sft', { overrides: { guidance_scale: 7.0, cfg_interval_end: 0.5 } }) },
      // Extra, fora da tabela do plano: a janela oposta, para o S5 não ficar sem par.
      { label: 'A-S5b', arm: 'S5b', codes: 'T_good', description: 'EXTRA: CFG 7 só com t ≥ 0,5 (cfg_interval_start 0,5: CFG só nos passos ruidosos)',
        input: fixedJob(S.T_good, 'sft', { overrides: { guidance_scale: 7.0, cfg_interval_start: 0.5 } }) },
      { label: 'A-S6', arm: 'S6', codes: 'T_good', description: "lyrics '' (como a produção manda), só no DiT", input: fixedJob(S.T_good, 'sft', { input: { lyrics: '' } }) },
      { label: 'A-S7', arm: 'S7', codes: 'T_good', description: 'tags de seção como letra, só no DiT', input: fixedJob(S.T_good, 'sft', { input: { lyrics: SECTION_TAGS } }) },
      { label: 'A-S9', arm: 'S9', codes: null, description: 'formato REAL da produção v2.5 (buildJobInput: lyrics \'\', instrumental, bpm/key nulos, 120 s, lote 2)',
        input: productionInput({ model: 'v2.5', styles: S.S_bad.input.caption, durationSeconds: 120, variants: 2 }) },
      { label: 'A-S9b', arm: 'S9b', codes: null, description: 'formato real da produção na v2.0 (32 passos), o opcional do S9',
        input: productionInput({ model: 'v2.0', styles: S.S_bad.input.caption, durationSeconds: 120, variants: 2 }) },
      { label: 'A-S10', arm: 'S10', codes: null, description: 'formato Midnight: [instrumental], instrumental false, bpm/key nulos, 120 s, lote 2',
        input: { ...tested, lyrics: '[instrumental]', instrumental: false, bpm: null, keyscale: null, duration: 120, batch_size: 2 } },
      { label: 'A-S11', arm: 'S11', codes: null, description: 'o pedido da rodada com lm_cfg 2,0 (lote 2)',
        input: { ...tested, batch_size: 2, _bench_overrides: { lm_cfg_scale: 2.0 } } },
      { label: 'A-S12', arm: 'S12', codes: null, description: 'o pedido da rodada com temperatura do LM 0,8 (lote 2)',
        input: { ...tested, batch_size: 2, _bench_overrides: { lm_temperature: 0.8 } } },
    ],
  };
}
if (PROCESSES.includes('B1')) {
  groups.B1 = {
    dit: DIT_TURBO,
    adapter: false,
    jobs: [
      { label: 'W-B1', arm: 'aquecimento', input: warmup('turbo') },
      { label: 'B1-T_base', arm: 'B1 sanidade', codes: 'T_base', sanity: { against: 'original', run: RUN_TURBO, file: 'pista--base-0.flac' },
        description: 'SANIDADE: os códigos da turbo pista--base no turbo sem adapter. Tem de sair igual ao FLAC original.', input: fixedJob(S.T_base, 'turbo') },
      { label: 'B1-S_bad', arm: 'B1 espelho S2', codes: 'S_bad', description: 'plano da SFT pista--base renderizado no turbo', input: fixedJob(S.S_bad, 'turbo') },
      { label: 'B1-S_ctl', arm: 'B1 espelho S8', codes: 'S_ctl', description: 'plano da SFT controle--base (jazz) renderizado no turbo', input: fixedJob(S.S_ctl, 'turbo') },
    ],
  };
}
if (PROCESSES.includes('B2')) {
  const lora = (scale) => (scale === 0 ? {} : { lora: STYLE, lora_scale: scale });
  const pct = (s) => `s${String(Math.round(s * 100)).padStart(3, '0')}`;
  const grid = [
    ['pista', ['T_base', 'T_pista2'], [0, 0.5, 1]],
    ['controle', ['T_ctl', 'T_ctl2'], [0, 0.5, 1]],
    ['vocal', ['T_voc', 'T_voc2'], [0, 0.3, 0.5, 1]],
  ];
  const jobs = [
    { label: 'W-B2', arm: 'aquecimento', input: warmup('turbo') },
    // Força 0 da grade = sem 'lora' no pedido (set_use_lora(False), o caminho da produção).
    // Este é o outro caminho de desligar: adapter ligado com multiplicador 0.
    { label: 'B2-toggle-escala0', arm: 'B2 toggle', codes: 'T_base', sanity: { against: 'B1-T_base' },
      description: "TOGGLE: T_base com lora 'eletronics' e lora_scale 0. Tem de sair igual a B1-T_base.",
      input: fixedJob(S.T_base, 'turbo', { input: { lora: STYLE, lora_scale: 0 } }) },
  ];
  for (const [prompt, draws, scales] of grid) {
    draws.forEach((key, i) => {
      for (const s of scales) {
        const label = `B2-${prompt}-c${i + 1}-${pct(s)}`;
        jobs.push({
          label,
          arm: `B2 ${prompt}`,
          codes: key,
          ...(prompt === 'pista' && i === 0 && s === 0 ? { sanity: { against: 'B1-T_base' } } : {}),
          description: `${prompt}, sorteio ${i + 1} (${S[key].what}), ${s === 0 ? 'adapter carregado e DESLIGADO' : `adapter força ${s}`}`,
          input: fixedJob(S[key], 'turbo', { input: lora(s) }),
        });
      }
    });
  }
  groups.B2 = { dit: DIT_TURBO, adapter: true, jobs };
}

// Nenhum braço do plano ficou de fora: todos cabem nos fatos verificados (códigos por
// _bench_audio_codes; CFG, janela, lm_cfg e temperatura por _bench_overrides; letra,
// metas e lote como campos normais do pedido). Se um dia algum não couber, ele sai
// daqui com uma linha de log dizendo qual e por quê, nunca em silêncio.
const DROPPED = [];

const measured = Object.values(groups).flatMap((g) => g.jobs).filter((j) => !j.label.startsWith('W-'));
const tracks = measured.flatMap((j) => Array.from({ length: j.input.batch_size ?? 1 }, (_, i) => ({ label: j.label, item: i })));
if (new Set(measured.map((j) => j.label)).size !== measured.length) fail('rótulo repetido no plano.');

// --- Estimativa ---------------------------------------------------------------------

// Medido na rodada 3 (L4): SFT 90 s = 47 s de job, dos quais ~8 s são a fase 2 do LM;
// turbo 90 s = 24 s (28 s com o LoKr carregado). Com códigos fixos a fase 2 não roda.
// O DiT escala com lote x duração. Carga de cada processo ~1 min; boot e downloads ~10 min.
function jobSeconds(group, j) {
  const scale = ((j.input.duration ?? 90) / 90) * (j.input.batch_size ?? 1);
  const lm = j.input._bench_audio_codes ? 0 : 8 + 2 * ((j.input.batch_size ?? 1) - 1);
  if (groups[group].dit === DIT_SFT) return lm + 39 * scale * ((j.input.inference_steps ?? 50) / 50);
  return lm + (groups[group].adapter ? 20 : 16) * scale;
}
const perGroup = Object.fromEntries(Object.entries(groups).map(([g, grp]) => [g, grp.jobs.reduce((t, j) => t + jobSeconds(g, j), 0)]));
const estMin = 10 + Object.keys(groups).length * 1.2 + Object.values(perGroup).reduce((a, b) => a + b, 0) / 60 + 2;

function printPlan() {
  log(`Experimento de render: processos ${Object.keys(groups).join(', ')}; GPU ${GPUS.length === 1 ? 'só L4' : GPUS.join(' / ')}; seed ${SEED}.`);
  log('Códigos de origem (extraídos dos group-*.log, um por faixa):');
  for (const s of Object.values(SOURCES)) {
    log(`  ${s.key.padEnd(8)} ${s.what}: ${codeTokens(s.codes).length} códigos, bpm ${s.input.bpm}, ${s.input.keyscale}, ts ${s.timesignature}, ${s.input.duration} s`);
  }
  for (const [g, grp] of Object.entries(groups)) {
    log(`Processo ${g} (${grp.dit}${grp.adapter ? ` + LoKr ${STYLE} ${ADAPTER_STAMP}` : ', sem adapter'}), ~${(perGroup[g] / 60).toFixed(1)} min de jobs:`);
    for (const j of grp.jobs.filter((x) => !x.label.startsWith('W-'))) {
      const ov = j.input._bench_overrides ? ` overrides ${JSON.stringify(j.input._bench_overrides)}` : '';
      const n = j.input.batch_size ?? 1;
      log(`  ${j.label.padEnd(20)} ${j.codes ? `códigos ${j.codes}` : 'LM livre'}${n > 1 ? `, lote ${n}` : ''}, ${j.input.duration} s: ${j.description}${ov}`);
    }
  }
  for (const d of DROPPED) log(`BRAÇO FORA: ${d}`);
  if (DROPPED.length === 0) log('Todos os braços do plano entraram (S5b e S9b são extras, marcados como tal).');
  log(
    `${measured.length} job(s), ${tracks.length} faixa(s) para escuta. Estimativa: ~${Math.round(estMin)} min de pod ` +
      `(~US$ ${((estMin / 60) * 0.45).toFixed(2)} numa L4 on-demand a ~US$ 0,45/h; no teto serverless do RUNPOD.md, US$ 0,0004/s, ~US$ ${(estMin * 60 * 0.0004).toFixed(2)}).`,
  );
  if (estMin > MAX_MIN) log(`AVISO: a estimativa passa do teto (--max-min=${MAX_MIN}).`);
}

// --- Comparação de onda (local, com numpy + soundfile) ------------------------------

const COMPARE_PY = `
import json, sys
import numpy as np, soundfile as sf
a, sra = sf.read(sys.argv[1], dtype="float64", always_2d=True)
b, srb = sf.read(sys.argv[2], dtype="float64", always_2d=True)
n = min(len(a), len(b))
d = a[:n] - b[:n]
ref = float(np.sqrt(np.mean(a[:n] ** 2))) or 1e-12
rms = float(np.sqrt(np.mean(d ** 2))) if n else 0.0
print(json.dumps({
    "amostras": [len(a), len(b)], "sr": [sra, srb],
    "igual_bit_a_bit": bool(len(a) == len(b) and sra == srb and np.array_equal(a, b)),
    "max_abs": float(np.max(np.abs(d))) if n else None,
    "dif_rel_db": round(20 * np.log10(rms / ref), 1) if rms > 0 else None,
}))
`;
const winPath = (p) => (PYTHON.toLowerCase().endsWith('.exe') ? execFileSync('wslpath', ['-w', p], { encoding: 'utf8' }).trim() : p);

/** null quando não há python com numpy/soundfile; senão o veredito e os números. */
function compareAudio(a, b) {
  try {
    const out = JSON.parse(execFileSync(PYTHON, ['-c', COMPARE_PY, winPath(a), winPath(b)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    out.veredito = out.igual_bit_a_bit
      ? 'idêntico'
      : out.amostras[0] !== out.amostras[1]
        ? 'diferente (duração)'
        : out.dif_rel_db < -40
          ? 'igual (ruído numérico)'
          : out.dif_rel_db < -20
            ? 'quase igual: confira'
            : 'diferente';
    return out;
  } catch {
    return null;
  }
}

// --- Verificações pelo log do processo ----------------------------------------------

/**
 * Prova de que os códigos NÃO foram regerados: `infer_type=dit`, sem `Phase 2: Generating
 * audio codes` e sem linha de códigos no log. Com as 4 metas fixas, a fase 1 também é pulada
 * (`Using user-provided metadata`). O DiT ainda tem de decodificar os códigos.
 */
function checkFixedJob(blockLines) {
  const has = (s) => blockLines.some((l) => l.includes(s));
  const problems = [];
  if (!has('infer_type=dit)')) problems.push('sem "infer_type=dit"');
  if (has('Phase 2: Generating audio codes')) problems.push('o LM regerou os códigos (Phase 2)');
  if (has(CODE_LINE)) problems.push('há linha de códigos do LM no log');
  if (!has('Decoding audio codes for item')) problems.push('sem "Decoding audio codes" no DiT');
  const warnings = [];
  if (!has('Phase 1: Using user-provided metadata')) warnings.push('a fase 1 (metas) rodou: o timesignature fixo não pegou');
  return { ok: problems.length === 0, problems, warnings };
}

// --- Adapter e payload -----------------------------------------------------------

/** O bloco ENV do Dockerfile do worker, como `export KEY=VALUE` (mesma leitura do benchmark-qualidade.mjs). */
function dockerfileEnv() {
  const text = readFileSync('apps/gpu-worker/Dockerfile', 'utf8').replace(/\r\n/g, '\n');
  const block = text.match(/^ENV ([\s\S]*?)\n\n/m)?.[1] ?? '';
  const argDefaults = Object.fromEntries([...text.matchAll(/^ARG (\w+)=(\S+)/gm)].map((m) => [m[1], m[2]]));
  const pairs = block
    .replace(/\\\n/g, ' ')
    .split(/\s+/)
    .filter((t) => t.includes('='))
    .map((p) => p.replace(/\$\{(\w+)\}/g, (_, k) => argDefaults[k] ?? ''));
  if (!pairs.some((p) => p.startsWith('ACESTEP_CONFIG_PATH='))) throw new Error('Não achei o ENV do Dockerfile.');
  return pairs.map((p) => `export ${p}`).join('\n') + '\n';
}

function buildPayload(adapterUrl) {
  const dir = join(tmpdir(), `sonora-experimento-render-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync('apps/gpu-worker/handler.py', join(dir, 'handler.py'));
  copyFileSync('scripts/benchmark-qualidade/bench_run.py', join(dir, 'bench_run.py'));
  writeFileSync(
    join(dir, 'runs.json'),
    JSON.stringify({ groups: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { jobs: g.jobs.map(({ label, description, input }) => ({ label, description, input })) }])) }),
  );
  writeFileSync(join(dir, 'adapters.json'), JSON.stringify({ style: STYLE, url: adapterUrl ?? null }));
  const on = (g) => (groups[g] ? 1 : 0);
  writeFileSync(join(dir, 'plan.sh'), `RUN_A=${on('A')}\nRUN_B1=${on('B1')}\nRUN_B2=${on('B2')}\n`);
  writeFileSync(join(dir, 'dockerenv.sh'), dockerfileEnv());
  execFileSync('tar', ['czf', 'payload.tgz', 'handler.py', 'bench_run.py', 'runs.json', 'adapters.json', 'plan.sh', 'dockerenv.sh'], { cwd: dir });
  return readFileSync(join(dir, 'payload.tgz')).toString('base64');
}
// O payload NÃO vai mais numa variável de ambiente: com 52,6 KiB o pod duas vezes nunca subiu
// ("não ganhou IP em 15 min"), enquanto os ~25 KiB do testar-lora sempre subiram. Ele vai para o
// bucket privado e o pod baixa por URL assinada, como o treino. O teto só evita um tarball absurdo.
const PAYLOAD_MAX = 4 * 1024 * 1024;

// --- Simulação ----------------------------------------------------------------------

printPlan();
const payloadPreview = buildPayload('https://exemplo.invalid/adapter');
log(`Payload: ${(payloadPreview.length / 1024).toFixed(1)} KiB em base64 (vai para o bucket privado, não para o ambiente do pod).`);
if (payloadPreview.length > PAYLOAD_MAX) fail('o payload passou de 4 MiB; reduza os braços.');
const selfTest = compareAudio(join(RUN_SFT, 'audio', 'pista--base-0.flac'), join(RUN_SFT, 'audio', 'pista--base-0.flac'));
if (selfTest?.igual_bit_a_bit) log(`Comparação de onda: ok (${PYTHON}).`);
else log(`AVISO: sem comparação de onda (${PYTHON} sem numpy/soundfile, ou faltou o FLAC original). S1 só será checado pelo log; passe --python=<exe>.`);
if (SIMULATE) process.exit(0);

// --- Pod de verdade -------------------------------------------------------------------

const { assertConfig, checkBucket, list, presignGet, put } = await import('./r2.mjs');
assertConfig();
await checkBucket();
let adapterUrl = null;
if (groups.B2) {
  const key = `lora/${STYLE}/adapters/${ADAPTER_STAMP}/lokr_weights.safetensors`;
  if (!(await list(`lora/${STYLE}/adapters/${ADAPTER_STAMP}/`)).some((o) => o.key === key)) fail(`não achei ${key} no bucket.`);
  if (!ADAPTER_STAMP.endsWith('-turbo')) fail(`o adapter ${ADAPTER_STAMP} não é da família turbo.`);
  adapterUrl = await presignGet(key, (MAX_MIN + 30) * 60);
}
const PAYLOAD = buildPayload(adapterUrl);
if (PAYLOAD.length > PAYLOAD_MAX) fail('o payload passou de 4 MiB.');
const payloadKey = `experimentos/render/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}/payload.tgz`;
await put(payloadKey, Buffer.from(PAYLOAD, 'base64'), 'application/gzip');
const PAYLOAD_URL = await presignGet(payloadKey, (MAX_MIN + 30) * 60);
log(`Payload no bucket privado: ${payloadKey}.`);

const POD_SCRIPT = String.raw`
set -u
mkdir -p /tmp/logs/out /tmp/logs/results /tmp/bench /tmp/adapters
T=/tmp/logs/timeline.txt
cd /app
(/app/.venv/bin/python -m http.server 8003 --directory /tmp/logs > /dev/null 2>&1 &)
echo "BOOT $(date +%s)" >> $T
/app/.venv/bin/python -c "import os, urllib.request; open('/tmp/payload.tgz', 'wb').write(urllib.request.urlopen(os.environ['PAYLOAD_URL'], timeout=300).read())" \
  || { echo "FAILED $(date +%s) download do payload" >> $T; sleep 7200; }
tar xzf /tmp/payload.tgz --no-same-owner -C /tmp/bench
source /tmp/bench/plan.sh
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader > /tmp/logs/gpu.txt 2>&1
echo "GPU $(date +%s) $(head -1 /tmp/logs/gpu.txt)" >> $T
uv pip install --python /app/.venv/bin/python -q requests runpod==1.12.0 > /tmp/logs/pip.log 2>&1
fetch_model() {
  for try in 1 2 3; do
    timeout 900 uv run --no-sync acestep-download $1 >> /tmp/logs/download-$2.log 2>&1 && return 0
    echo "DOWNLOAD_RETRY $2 $try $(date +%s)" >> $T
  done
  return 1
}
die() {
  echo "FAILED $(date +%s) $1" >> $T
  sleep 7200
  exit 1
}
fetch_model "" main || die "download do modelo principal travou (ver download-main.log)"
if [ $RUN_A = 1 ]; then
  fetch_model "--model ${DIT_SFT}" sft || die "download do XL-SFT travou (ver download-sft.log)"
  echo "SFT_READY $(date +%s)" >> $T
fi
# O XL-turbo baixa em segundo plano enquanto o processo A roda (cabem os dois no disco).
TURBO_PID=""
if [ $RUN_B1 = 1 ] || [ $RUN_B2 = 1 ]; then
  ( fetch_model "--model ${DIT_TURBO}" turbo && echo "TURBO_READY $(date +%s)" >> $T ) &
  TURBO_PID=$!
fi
if [ $RUN_B2 = 1 ]; then
  /app/.venv/bin/python - > /tmp/logs/adapter.log 2>&1 <<'PY' && echo "ADAPTER_READY $(date +%s)" >> $T
import json, os, urllib.request
cfg = json.load(open("/tmp/bench/adapters.json"))
dest = f"/tmp/adapters/B2/{cfg['style']}"
os.makedirs(dest, exist_ok=True)
with urllib.request.urlopen(cfg["url"], timeout=600) as res, open(f"{dest}/lokr_weights.safetensors", "wb") as f:
    while chunk := res.read(1 << 20):
        f.write(chunk)
PY
fi

run_group() {
  ( set -a; . /tmp/bench/dockerenv.sh; set +a
    ACESTEP_CONFIG_PATH=$2 ACESTEP_LORA_DIR=$3 \
    BENCH_DIR=/tmp/bench LOGS_DIR=/tmp/logs PYTHONPATH=/tmp/bench \
    /app/.venv/bin/python /tmp/bench/bench_run.py $1 > /tmp/logs/group-$1.log 2>&1 ) \
    || echo "GROUP_FAILED $1 $(date +%s) ver group-$1.log" >> $T
}

[ $RUN_A = 1 ] && run_group A ${DIT_SFT} ""
if [ -n "$TURBO_PID" ]; then
  if wait $TURBO_PID; then
    [ $RUN_B1 = 1 ] && run_group B1 ${DIT_TURBO} ""
    if [ $RUN_B2 = 1 ]; then
      if [ -s /tmp/adapters/B2/${STYLE}/lokr_weights.safetensors ]; then
        run_group B2 ${DIT_TURBO} /tmp/adapters/B2
      else
        echo "GROUP_FAILED B2 $(date +%s) download do adapter (ver adapter.log)" >> $T
      fi
    fi
  else
    [ $RUN_B1 = 1 ] && echo "GROUP_FAILED B1 $(date +%s) download do XL-turbo travou (ver download-turbo.log)" >> $T
    [ $RUN_B2 = 1 ] && echo "GROUP_FAILED B2 $(date +%s) download do XL-turbo travou (ver download-turbo.log)" >> $T
  fi
fi
echo "ALL_DONE $(date +%s)" >> $T
sleep 7200
`;

// --- Orquestração (mesmo padrão do testar-lora.mjs) ----------------------------------

async function runpod(method, path, body) {
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(`${REST}${path}`, {
        method,
        headers: { Authorization: `Bearer ${RUNPOD_KEY}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      break;
    } catch (err) {
      if (attempt >= 5) throw err;
      await sleep(5_000 * attempt);
    }
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`RunPod ${method} ${path} -> ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

let podId = null;
let costPerHr = null;
let createdAt = null;
let terminated = false;

async function terminate(reason) {
  if (!podId || terminated) return;
  terminated = true;
  log(`Destruindo o pod ${podId} (${reason})...`);
  try {
    await runpod('DELETE', `/pods/${podId}`);
    log('Pod destruído.');
  } catch (err) {
    console.error(`\n!!! FALHA AO DESTRUIR O POD ${podId}: ${err.message}\n!!! Destrua em https://www.runpod.io/console/pods\n`);
  }
  if (costPerHr && createdAt) {
    const h = (Date.now() - createdAt) / 3_600_000;
    log(`Custo aproximado: US$ ${(costPerHr * h).toFixed(3)} (${costPerHr}/h por ${(h * 60).toFixed(0)} min)`);
  }
}

process.on('SIGINT', async () => {
  await terminate('Ctrl+C');
  process.exit(130);
});
setTimeout(async () => {
  await terminate(`teto de ${MAX_MIN} min`);
  process.exit(2);
}, MAX_MIN * 60_000);

async function fetchBytes(url, timeoutMs = 30_000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
const outDir = join('docs', 'benchmarks', 'experimento-render', stamp);

// Nomes cegos: uma permutação sorteada de todas as faixas medidas (inclusive as de sanidade).
const order = tracks.map((t) => ({ ...t, r: randomInt(1 << 30) })).sort((a, b) => a.r - b.r);
const blind = new Map(order.map((t, i) => [`${t.label}#${t.item}`, `faixa-${String(i + 1).padStart(2, '0')}`]));
const jobByLabel = new Map(measured.map((j) => [j.label, j]));
const done = new Map(); // label -> resultado do bench_run
const checks = new Map(); // label -> verificações (log, códigos, onda)
let gpuName = null;

const localAudio = (label, item) => join(outDir, 'audio', `${blind.get(`${label}#${item}`)}.flac`);

const fixedOk = (c) => (!c.log || c.log.ok) && typeof c.codigos !== 'string';

/** Os códigos que o bench_run diz ter renderizado conferem com os injetados? */
function codesMatch(job, result) {
  if (!job.input._bench_audio_codes) return null;
  const got = Array.isArray(result.audio_codes) ? result.audio_codes[0] : result.audio_codes;
  // Sem o campo não dá para conferir aqui; o log do processo ainda prova (checkFixedJob).
  if (got == null) return null;
  return codeTokens(got).join('') === job.input._bench_audio_codes ? true : 'os códigos renderizados diferem dos injetados';
}

function sanityCompare(job) {
  const s = job.sanity;
  if (!s) return null;
  const ref = s.against === 'original' ? join(s.run, 'audio', s.file) : localAudio(s.against, 0);
  const mine = localAudio(job.label, 0);
  if (!existsSync(ref) || !existsSync(mine)) return { veredito: 'sem arquivo para comparar', ref };
  const cmp = compareAudio(ref, mine);
  return cmp ? { ...cmp, ref } : { veredito: 'sem python com numpy/soundfile', ref };
}

function writeReport() {
  const faixas = order.map((t) => {
    const job = jobByLabel.get(t.label);
    const r = done.get(t.label);
    return {
      faixa: blind.get(`${t.label}#${t.item}`),
      label: t.label,
      item: t.item,
      braco: job.arm,
      processo: t.label.split('-')[0],
      descricao: job.description,
      codigos: job.codes ? { fonte: job.codes, origem: SOURCES[job.codes].what } : 'LM livre',
      pedido: Object.fromEntries(Object.entries(job.input).filter(([k]) => k !== '_bench_audio_codes')),
      ok: r?.ok ?? null,
      wall_s: r?.wall_s ?? null,
    };
  });
  const verificacoes = Object.fromEntries([...checks.entries()]);
  writeFileSync(
    join(outDir, 'gabarito.json'),
    JSON.stringify(
      {
        data: stamp,
        gpu: gpuName,
        imagem: IMAGE,
        adapter_b2: groups.B2 ? `${STYLE}/${ADAPTER_STAMP}` : null,
        origens: Object.fromEntries(Object.values(SOURCES).map((s) => [s.key, { rodada: s.run, label: s.label, timesignature: s.timesignature, codigos: codeTokens(s.codes).length }])),
        bracos_fora: DROPPED,
        faixas,
        verificacoes,
      },
      null,
      2,
    ),
  );

  const sanity = [...checks.entries()].filter(([l]) => jobByLabel.get(l)?.sanity);
  const sanityLine = sanity.length
    ? sanity.map(([l, c]) => `${l} ${c.onda?.veredito ?? '(onda não comparada)'}${c.log && !c.log.ok ? ' + log com problema' : ''}`).join('; ')
    : 'ainda sem resultado';
  const allFixedOk = [...checks.values()].every(fixedOk);
  const md = [
    '# Escuta cega: experimento de render (códigos do LM fixos)',
    '',
    `${stamp}, ${gpuName ?? 'GPU ?'}. ${tracks.length} faixas, nomes sorteados.`,
    '',
    '**Não abra `gabarito.json` nem `resultados/` antes de terminar as notas.** Algumas faixas são o mesmo plano',
    'musical renderizado de outro jeito; outras são cópias de controle, e devem soar iguais a alguma faixa.',
    '',
    `Verificações automáticas (sem escuta): sanidade ${sanityLine}; códigos fixos ${allFixedOk ? 'respeitados em todos os jobs conferidos' : 'COM PROBLEMA (ver gabarito.json > verificacoes)'}.`,
    ANY_GPU
      ? 'Fora da L4 a onda de S1/B1 sempre diverge dos originais; vale o log (códigos injetados) e o toggle do B2 (idêntico = render determinística).'
      : 'Se a sanidade não deu "idêntico" ou "igual", pare: nenhuma conclusão vale.',
    '',
    '## O que anotar em cada faixa',
    '',
    '- **Nota de 1 a 5:** 1 = quebrada (descompasso, robótica, ruído); 3 = aceitável; 5 = pronta para produção.',
    '- **Quedas de volume:** o tempo de CADA uma (mm:ss) e se soa como arranjo (intro, breakdown, sidechain) ou como defeito.',
    '- **Descompasso, distorção ou voz onde não devia** (o "Yeah"): o tempo de cada trecho.',
    '- Para as faixas cantadas: a letra é inteligível? A voz soa natural?',
    '',
    '| faixa | ouvir | nota (1–5) | quedas de volume (mm:ss, arranjo/defeito) | descompasso, ruído, voz indevida (mm:ss) | comentário |',
    '|---|---|---|---|---|---|',
    ...order.map((t) => {
      const name = blind.get(`${t.label}#${t.item}`);
      const r = done.get(t.label);
      const link = r ? (r.ok ? `[ouvir](audio/${name}.flac)` : 'ERRO') : '—';
      return `| ${name} | ${link} |  |  |  |  |`;
    }),
    '',
    '## Depois de pontuar',
    '',
    'Abra `gabarito.json` (`faixas`: qual braço é cada faixa) e leia pela tabela do plano:',
    '',
    '- S1 ou a sanidade do B1 diferentes do original: a injeção falhou. Pare, sem conclusões.',
    '- S2/S3/S8 ruins e B1-S_bad/B1-S_ctl bons: a causa está no render XL-SFT. S4, S5, S5b, S6 e S7 apontam a alavanca do DiT.',
    '- S2/S3 bons e S1 ruim: a causa está no plano do LM. S10, S11 e S12 dizem se é metas, lm_cfg ou temperatura.',
    '- S2 ruim e B1-S_bad também ruim: os dois planos são frágeis; o render não é o principal.',
    '- S9 (e S9b) bons: a v2.x instrumental da produção está ok nos defaults. Ruins: a produção está afetada.',
    '- B2 força 0 igual ao B1-T_base: o toggle não muda o áudio (resta o custo de tempo; compare o wall_s).',
    '- B2: 0,5 vence a força 0 em ≥3 dos 4 pares instrumentais e 1,0 tem queda marcada nos dois sorteios de pista: libera 0,5 para instrumental.',
    '- B2 vocal 0,3/0,5 empata ou perde para a força 0: vocal fica com o adapter desligado.',
    '- Quedas no mesmo tempo em todas as forças do mesmo sorteio: a queda é do plano do LM e do gênero, não do adapter.',
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'escuta.md'), md);
}

async function saveLogs(base) {
  for (const g of Object.keys(groups)) {
    const txt = await fetchBytes(`${base}/group-${g}.log`);
    if (txt) writeFileSync(join(outDir, 'resultados', `group-${g}.log`), txt);
  }
  for (const f of ['timeline.txt', 'gpu.txt', 'adapter.log']) {
    const txt = await fetchBytes(`${base}/${f}`);
    if (txt) writeFileSync(join(outDir, 'resultados', f), txt);
  }
}

/** Confere pelo log do processo cada job de códigos fixos já terminado. */
function checkLogs(text) {
  for (const b of logBlocks(text)) {
    const job = jobByLabel.get(b.label);
    if (!job?.input._bench_audio_codes) continue;
    const entry = checks.get(b.label) ?? {};
    entry.log = checkFixedJob(b.lines);
    checks.set(b.label, entry);
  }
}

async function main() {
  mkdirSync(join(outDir, 'resultados'), { recursive: true });
  mkdirSync(join(outDir, 'audio'), { recursive: true });
  writeReport();

  const pod = await runpod('POST', '/pods', {
    name: 'sonora-experimento-render',
    imageName: IMAGE,
    gpuTypeIds: GPUS,
    gpuTypePriority: 'custom',
    gpuCount: 1,
    cloudType: 'SECURE',
    containerDiskInGb: 120,
    volumeInGb: 0,
    minRAMPerGPU: 32,
    ports: ['8003/tcp'],
    env: { PAYLOAD_URL, PYTHONUNBUFFERED: '1' },
    dockerEntrypoint: ['bash', '-c'],
    dockerStartCmd: [POD_SCRIPT],
  });
  podId = pod.id;
  costPerHr = pod.costPerHr ?? null;
  createdAt = Date.now();
  log(`Pod ${podId} criado (US$ ${costPerHr ?? '?'}/h).`);

  let base = null;
  let lastPodStatus = '';
  while (!base) {
    if (Date.now() - createdAt > 15 * 60_000) throw new Error('o pod não ganhou IP em 15 min (imagem presa no host)');
    // Sem máquina em 4 min = sem estoque da GPU pedida (visto com a L4): não paga os 15 min.
    if (Date.now() - createdAt > 4 * 60_000 && !lastPodStatus.includes('NVIDIA')) {
      throw new Error(`o pod não ganhou máquina em 4 min (sem estoque de ${GPUS.join(' / ')}?); tente --gpu-qualquer`);
    }
    await sleep(10_000);
    const p = await runpod('GET', `/pods/${podId}`);
    costPerHr ??= p.costPerHr ?? null;
    // Se o pod não subir, o motivo fica no log: status, máquina e a última mudança de estado.
    const status = [p.desiredStatus, p.lastStatusChange, p.machine?.gpuDisplayName, p.machine?.dataCenterId].filter(Boolean).join(' | ');
    if (status && status !== lastPodStatus) log(`status do pod: ${(lastPodStatus = status)}`);
    const port = p.portMappings?.['8003'];
    if (p.publicIp && port) base = `http://${p.publicIp}:${port}`;
  }
  log(`Pod no ar: ${base}`);

  try {
    const seen = new Set();
    let lastContact = Date.now();
    for (let finished = false; !finished; ) {
      await sleep(10_000);
      const raw = await fetchBytes(`${base}/timeline.txt`);
      if (!raw) {
        if (Date.now() - lastContact > 10 * 60_000) throw new Error('o pod parou de responder por 10 min');
        continue;
      }
      lastContact = Date.now();
      for (const line of raw.toString('utf8').trim().split('\n')) {
        if (seen.has(line)) continue;
        seen.add(line);
        log(`pod: ${line}`);

        if (line.startsWith('FAILED')) throw new Error(line);
        const gpu = line.match(/^GPU \d+ (.+)$/);
        if (gpu) gpuName = gpu[1].split(',')[0].trim();
        const failed = line.match(/^GROUP_FAILED (\S+)/);
        if (failed) {
          const tail = (await fetchBytes(`${base}/group-${failed[1]}.log`))?.toString('utf8').trimEnd().split('\n').slice(-25).join('\n');
          log(`O processo ${failed[1]} falhou. Fim do log:\n${tail ?? '(sem log)'}`);
          if (failed[1] === 'A' && !done.has('A-S1')) throw new Error('o processo A caiu antes da sanidade S1');
        }
        const jobDone = line.match(/^JOB_DONE (\S+) (ok|ERRO)/);
        if (!jobDone || jobDone[1].startsWith('W-')) {
          if (line.startsWith('ALL_DONE')) finished = true;
          continue;
        }
        const label = jobDone[1];
        const job = jobByLabel.get(label);
        const json = await fetchBytes(`${base}/results/${label}.json`);
        if (json) writeFileSync(join(outDir, 'resultados', `${label}.json`), json);
        const meta = json ? JSON.parse(json.toString('utf8')) : { ok: false, error: 'sem results json' };
        done.set(label, meta);
        if (!meta.ok) log(`${label}: ${String(meta.error).slice(0, 400)}`);
        for (const t of meta.output?.tracks ?? []) {
          const item = Number(t.storage_key.match(/-(\d+)\.flac$/)?.[1] ?? 0);
          const audio = await fetchBytes(`${base}/out/${t.storage_key}`, 300_000);
          if (audio) {
            writeFileSync(localAudio(label, item), audio);
            log(`baixado ${t.storage_key} (${(audio.length / 1e6).toFixed(1)} MB)`);
          }
        }

        const entry = checks.get(label) ?? {};
        const cm = codesMatch(job, meta);
        if (cm !== null) entry.codigos = cm;
        if (job.sanity && meta.ok) {
          entry.onda = sanityCompare(job);
          log(`${label} x ${job.sanity.against === 'original' ? 'FLAC original' : job.sanity.against}: ${entry.onda.veredito}` +
            (entry.onda.dif_rel_db != null ? ` (diferença ${entry.onda.dif_rel_db} dB, máx ${entry.onda.max_abs?.toExponential(2)})` : ''));
        }
        checks.set(label, entry);

        // S1 decide se o resto vale alguma coisa: os códigos injetados têm de ser os
        // renderizados, o LM não pode ter regerado nada e a onda tem de bater com a original.
        if (label === 'A-S1') {
          const groupLog = (await fetchBytes(`${base}/group-A.log`))?.toString('utf8') ?? '';
          checkLogs(groupLog);
          const c = checks.get(label);
          const reasons = [];
          if (!meta.ok) reasons.push(`o job falhou: ${String(meta.error).slice(0, 200)}`);
          if (c.log && !c.log.ok) reasons.push(c.log.problems.join(', '));
          if (!c.log) reasons.push('o bloco do S1 não apareceu no group-A.log');
          if (typeof c.codigos === 'string') reasons.push(c.codigos);
          if (c.onda && /^diferente/.test(c.onda.veredito)) {
            if (ANY_GPU) log(`AVISO S1: a onda não bate com a original da L4 (${c.onda.veredito}); em outra GPU isso é esperado, vale o log.`);
            else reasons.push(`a onda não bate com a original (${c.onda.veredito})`);
          }
          for (const w of c.log?.warnings ?? []) log(`AVISO S1: ${w}`);
          if (reasons.length) {
            writeReport();
            throw new Error(`sanidade S1 falhou, experimento abortado: ${reasons.join('; ')}`);
          }
          log('Sanidade S1 ok: códigos injetados, LM sem regerar' + (c.onda?.igual_bit_a_bit !== undefined ? `, onda ${c.onda.veredito}.` : ' (onda não comparada).'));
        }
        writeReport();
      }
    }
  } finally {
    await saveLogs(base);
  }

  for (const g of Object.keys(groups)) {
    const p = join(outDir, 'resultados', `group-${g}.log`);
    if (existsSync(p)) checkLogs(readFileSync(p, 'utf8'));
  }
  writeReport();

  for (const [label, c] of checks) {
    if (c.log && !c.log.ok) log(`PROBLEMA ${label}: ${c.log.problems.join(', ')}`);
    for (const w of c.log?.warnings ?? []) log(`AVISO ${label}: ${w}`);
    if (typeof c.codigos === 'string') log(`PROBLEMA ${label}: ${c.codigos}`);
  }
  const ok = measured.filter((j) => done.get(j.label)?.ok).length;
  log(`${ok} de ${measured.length} job(s) ok (${tracks.length} faixas). Escute pela tabela em ${join(outDir, 'escuta.md')}`);
  // Job que regerou os códigos ou sanidade que não bateu também é falha: a faixa existe, mas não vale.
  const bad = [...checks.entries()].filter(([l, c]) => !fixedOk(c) || /^diferente/.test(c.onda?.veredito ?? '')).map(([l]) => l);
  if (bad.length) log(`Não valem para a comparação: ${bad.join(', ')} (ver gabarito.json > verificacoes).`);
  if (ok < measured.length || bad.length) process.exitCode = 1;
}

try {
  await main();
} catch (err) {
  console.error(`\nERRO: ${err.message}`);
  process.exitCode = 1;
} finally {
  await terminate('fim');
}
process.exit(process.exitCode ?? 0);
