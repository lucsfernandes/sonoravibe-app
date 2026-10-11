#!/usr/bin/env node
/**
 * A/B de escuta de um LoKr treinado por treinar-lora.mjs: os mesmos prompts e a mesma
 * seed com o adapter DESLIGADO (o modelo de sempre) e LIGADO em cada força pedida.
 *
 * O A/B é PAREADO: o seed não chega ao LM (backend vllm), então cada job sortearia uma
 * estrutura nova (códigos do LM). Por isso a coluna sem adapter gera os códigos e cada
 * coluna com adapter do mesmo prompt reaproveita exatamente esses códigos (e as metas que
 * o LM escolheu): no pod, parear.py copia o 'audio_codes' do resultado da referência para
 * o '_bench_audio_codes' do job (o bench_run.py injeta no GenerationParams). Assim o que
 * muda entre as colunas é o adapter e a força no DiT. No fim, o log de cada grupo é
 * conferido: job pareado não pode ter 'Phase 2: Generating audio codes'.
 *
 * A escuta é CEGA: escuta.md lista as faixas de cada prompt com nomes neutros (A1, A2...)
 * em ordem embaralhada (semente = data do adapter), copiadas para cega/. O mapa nome ->
 * variação fica só em gabarito.json.
 *
 * Roda o `handler.py` REAL do worker (apps/gpu-worker) num pod da RunPod, no mesmo
 * digest da imagem, com o perfil da versão da família do adapter (pasta -sft: v2.5,
 * XL-SFT com 50 passos e sem reescrita do caption; pasta -turbo: v1.5). Ou seja: o caminho de adapter que vai para produção (ACESTEP_LORA_DIR +
 * inputs lora/lora_scale) é exercitado de verdade, não uma cópia dele.
 *
 * Uso:
 *   node scripts/lora/testar-lora.mjs <estilo>
 *   opções: --adapter=<data>           pasta em lora/<estilo>/adapters/ (padrão: a mais recente)
 *           --checkpoints=final        final | todos | lista (ex.: epoca-100,final)
 *           --escalas=0.5,1            forças do adapter (0 a 1)
 *           --duracao=90               segundos por faixa
 *           --seed=42
 *           --max-min=60               teto do pod inteiro
 *           --simular                  mostra o plano e o custo estimado, sem criar pod
 *
 * Prompts: scripts/lora/prompts-teste/<estilo>.json (ver country.json). Use prompts
 * FORA do dataset e um 'controle' de outro estilo: adapter bom leva o estilo para
 * música nova e não contamina o que não pediu. Um prompt com "familias": ["sft"] só roda
 * no XL-SFT (ex.: variação de style_influence, que o turbo ignora: seria uma réplica).
 *
 * Saída: docs/benchmarks/lora-<estilo>/<data do adapter>/pareado-<data UTC da rodada>/, uma
 * pasta NOVA a cada execução, com os FLACs (audio/, com o rótulo; cega/, com o nome neutro),
 * os JSONs e logs de cada job, escuta.md (a tabela cega para ouvir lado a lado) e
 * gabarito.json (o mapa, para abrir só depois das notas). Nada do que já está em
 * <data do adapter>/ é sobrescrito: as rodadas antigas (não pareadas, gravadas direto ali)
 * são a fonte dos códigos e dos FLACs originais do experimento-render.mjs, e docs/benchmarks
 * não vai para o git (o que se perde ali não volta).
 *
 * O pod é SEMPRE destruído: em sucesso, erro, Ctrl+C ou no teto. Ele nunca recebe
 * credenciais do R2, só URLs assinadas do adapter.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { assertConfig, checkBucket, getText, list, presignGet, slug } from './r2.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${def}`).split('=')[1];
const styleArg = args.find((a) => !a.startsWith('--'));
if (!styleArg) {
  console.error('Uso: node scripts/lora/testar-lora.mjs <estilo> [--adapter=<data>] [--checkpoints=final|todos|epoca-100,final] [--escalas=0.5,1] [--duracao=90] [--simular]');
  process.exit(1);
}
const style = slug(styleArg);
const SIMULATE = args.includes('--simular');
const SCALES = opt('escalas', '0.5,1').split(',').map(Number);
const DURATION = Number(opt('duracao', 90));
const SEED = Number(opt('seed', 42));
const MAX_MIN = Number(opt('max-min', 60));
if (SCALES.some((s) => !(s > 0 && s <= 1))) {
  console.error('--escalas: valores entre 0 (exclusive) e 1. O 0 já é a referência sem adapter.');
  process.exit(1);
}
if (!(DURATION >= 10 && DURATION <= 480)) {
  console.error('--duracao: entre 10 e 480 s (os limites do handler).');
  process.exit(1);
}

const RUNPOD_KEY = process.env.RUNPOD_API_KEY;
if (!RUNPOD_KEY && !SIMULATE) {
  console.error('Faltou RUNPOD_API_KEY no .env.');
  process.exit(1);
}

// O mesmo digest do apps/gpu-worker/Dockerfile e do treino.
const IMAGE = 'ghcr.io/ace-step/ace-step-1.5@sha256:95652cd780c78a1b1a7f6f0335530430f0ae53d96c7c12d59f9f39fa23d38567';
// Inferência do XL-SFT com offload cabe em 24 GB (benchmark de voz); qualidade não depende da GPU.
const GPUS = [
  'NVIDIA L4', 'NVIDIA RTX A5000', 'NVIDIA GeForce RTX 3090', 'NVIDIA GeForce RTX 4090',
  'NVIDIA A40', 'NVIDIA RTX A6000',
];
const REST = 'https://rest.runpod.io/v1';

const t0 = Date.now();
const log = (msg) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(5)}s] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Entrada: prompts e adapter --------------------------------------------------

const promptsFile = join('scripts', 'lora', 'prompts-teste', `${style}.json`);
if (!existsSync(promptsFile)) {
  console.error(`Faltou ${promptsFile}. Copie o country.json e troque os prompts pelos do estilo (fora do dataset, mais um 'controle' de outro estilo).`);
  process.exit(1);
}
const allPrompts = JSON.parse(readFileSync(promptsFile, 'utf8')).prompts;
for (const p of allPrompts) {
  if (!/^[a-z0-9-]+$/.test(p.id ?? '') || !p.input?.caption) {
    console.error(`${promptsFile}: cada prompt precisa de 'id' (minúsculas, números, hífen) e 'input.caption'.`);
    process.exit(1);
  }
  if (p.familias !== undefined && !(Array.isArray(p.familias) && p.familias.every((f) => f === 'sft' || f === 'turbo'))) {
    console.error(`${promptsFile}: 'familias' de '${p.id}' precisa ser uma lista com 'sft' e/ou 'turbo'.`);
    process.exit(1);
  }
}
if (new Set(allPrompts.map((p) => p.id)).size !== allPrompts.length) {
  console.error(`${promptsFile}: 'id' repetido (os códigos do LM são pareados pelo id).`);
  process.exit(1);
}

// O pareamento depende do bench_run.py aceitar os códigos prontos: sem isso, cada coluna
// sortearia uma estrutura nova e a rodada não compararia nada. O compasso que o LM
// escolheu na referência vai por '_bench_overrides' (sem ele, a fase 1 do LM sorteia de novo).
const benchSrc = readFileSync(join('scripts', 'benchmark-qualidade', 'bench_run.py'), 'utf8');
const BENCH_CODES = benchSrc.includes('_bench_audio_codes');
const BENCH_OVERRIDES = benchSrc.includes('_bench_overrides');

assertConfig();
await checkBucket();

const prefix = `lora/${style}`;
const keys = (await list(`${prefix}/adapters/`)).map((o) => o.key).filter((k) => k.endsWith('/lokr_weights.safetensors'));
const stamps = [...new Set(keys.map((k) => k.slice(`${prefix}/adapters/`.length).split('/')[0]))].sort();
if (stamps.length === 0) {
  console.error(`Nenhum adapter em ${prefix}/adapters/. Treine antes: node scripts/lora/treinar-lora.mjs ${style}`);
  process.exit(1);
}
const stamp = opt('adapter', stamps.at(-1));
if (!stamps.includes(stamp)) {
  console.error(`Adapter '${stamp}' não existe. Disponíveis: ${stamps.join(', ')}`);
  process.exit(1);
}
// 'final' é o lokr_weights.safetensors da raiz da data; os demais, epoca-N/.
const available = keys
  .filter((k) => k.startsWith(`${prefix}/adapters/${stamp}/`))
  .map((k) => {
    const rest = k.slice(`${prefix}/adapters/${stamp}/`.length);
    return { name: rest.includes('/') ? rest.split('/')[0] : 'final', key: k };
  })
  .sort((a, b) => (a.name === 'final') - (b.name === 'final') || Number(a.name.split('-')[1]) - Number(b.name.split('-')[1]));

// A família vem no nome da pasta (treinar-lora.mjs --modelo). Sem sufixo = SFT, dos treinos antigos.
const FAMILY = stamp.endsWith('-turbo') ? 'turbo' : 'sft';
const DIT = FAMILY === 'turbo' ? 'acestep-v15-xl-turbo' : 'acestep-v15-xl-sft';
// O perfil da versão do produto em que o adapter vai ser usado (packages/shared/src/models.ts).
const PROFILE =
  FAMILY === 'turbo'
    ? { task_type: 'text2music', model_family: 'turbo', cot_caption: false, style_influence: 50, variety: 'high' } // v1.5
    : { task_type: 'text2music', model_family: 'sft', inference_steps: 50, cot_caption: false, style_influence: 50, variety: 'high' }; // v2.5
const PROFILE_NAME = FAMILY === 'turbo' ? 'v1.5 (XL-turbo, 8 passos, sem CFG)' : 'v2.5 (XL-SFT, 50 passos, sem reescrita do caption)';

// Os prompts desta família. No turbo o style_influence não chega ao modelo (sem CFG): um
// prompt que só difere de outro nele é réplica, não variante. Sai pelo 'familias' ou, se o
// JSON não marcou, pela comparação.
const semAderencia = (p) =>
  JSON.stringify(Object.entries(p.input).filter(([k]) => k !== 'style_influence').sort(([a], [b]) => a.localeCompare(b)));
const prompts = [];
for (const p of allPrompts) {
  if (p.familias && !p.familias.includes(FAMILY)) {
    log(`Prompt '${p.id}' fora desta rodada: só para ${p.familias.join('/')}.`);
    continue;
  }
  const twin = FAMILY === 'turbo' && prompts.find((q) => semAderencia(q) === semAderencia(p));
  if (twin) {
    log(`Prompt '${p.id}' fora desta rodada: no turbo é igual a '${twin.id}' (só muda o style_influence, que o turbo ignora).`);
    continue;
  }
  prompts.push(p);
}

const ckptArg = opt('checkpoints', 'final');
let checkpoints;
if (ckptArg === 'todos') {
  checkpoints = available;
} else if (ckptArg === 'final') {
  // Treino que bateu no teto não tem 'final': vale o último checkpoint.
  checkpoints = [available.find((c) => c.name === 'final') ?? available.at(-1)];
} else {
  checkpoints = ckptArg.split(',').map((name) => {
    const c = available.find((a) => a.name === name);
    if (!c) {
      console.error(`Checkpoint '${name}' não existe em ${stamp}. Disponíveis: ${available.map((a) => a.name).join(', ')}`);
      process.exit(1);
    }
    return c;
  });
}

/** O lokr_config do cabeçalho do safetensors (8 bytes de tamanho + JSON), lido por Range. */
async function lokrConfig(key) {
  const url = await presignGet(key, 600);
  const range = async (from, to) => {
    const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`leitura de ${key} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const size = Number((await range(0, 7)).readBigUInt64LE(0));
  const header = JSON.parse((await range(8, 7 + size)).toString('utf8'));
  return JSON.parse(header.__metadata__?.lokr_config ?? '{}');
}
// O handler recusa LoKr com DoRA (multiplicador 0 não o desliga): falha aqui, antes de pagar o pod.
for (const c of checkpoints) {
  if ((await lokrConfig(c.key)).weight_decompose) {
    console.error(
      `O adapter ${stamp}/${c.name} foi treinado com DoRA (weight_decompose): ele não desliga nem tem força ajustável, ` +
        `e o handler recusa carregá-lo. Treine de novo: node scripts/lora/treinar-lora.mjs ${style} (o DoRA agora vai desligado).`,
    );
    process.exit(1);
  }
}

// O gatilho do treino (--tag) foi prefixado em todo caption do dataset. Vai nos dois
// lados do A/B: assim o pedido é o mesmo e só o adapter muda.
const labels = JSON.parse(
  (await getText(`${prefix}/rotulos/dataset.revisado.json`)) ?? (await getText(`${prefix}/rotulos/dataset.json`)) ?? '{}',
);
const tag = (labels.metadata?.custom_tag ?? '').trim();
const caption = (c) => (tag ? `${tag}, ${c}` : c);

// --- O plano: um grupo (um processo do handler) por checkpoint ------------------

const pct = (s) => `s${String(Math.round(s * 100)).padStart(3, '0')}`;
const input = (p, extra = {}) => ({ ...PROFILE, ...p.input, caption: caption(p.input.caption), duration: DURATION, seed: SEED, batch_size: 1, ...extra });
// A referência roda num processo SEM adapter carregado. "Desligar" o adapter no mesmo processo
// não serve: com DoRA o multiplicador 0 do LyCORIS deixa o delta inteiro nos pesos (foi o que
// estragou a 1ª rodada do modern-metal), e nada garante que outro modo não deixe resíduo.
// Ela roda primeiro e o LM sorteia ali a estrutura de cada prompt; as colunas com adapter
// apontam para ela em '_bench_codes_from' e o parear.py troca isso pelos códigos no pod.
const refLabel = (p) => `${p.id}--base`;
const groups = {
  base: {
    checkpoint: null,
    jobs: [
      { label: 'W-base', description: 'aquecimento (não medido)', input: input(prompts[0], { duration: 10 }) },
      ...prompts.map((p) => ({ label: refLabel(p), description: `${p.descricao}: SEM adapter (gera os códigos do LM)`, input: input(p) })),
    ],
  },
};
checkpoints.forEach((c) => {
  const jobs = [{ label: `W-${c.name}`, description: 'aquecimento (não medido)', input: input(prompts[0], { duration: 10 }) }];
  for (const p of prompts) {
    for (const s of SCALES) {
      jobs.push({
        label: `${p.id}--${c.name}--${pct(s)}`,
        description: `${p.descricao}: adapter ${c.name}, força ${s}, códigos de ${refLabel(p)}`,
        input: input(p, { lora: style, lora_scale: s, _bench_codes_from: refLabel(p) }),
      });
    }
  }
  groups[c.name] = { checkpoint: c, jobs };
});
const measured = Object.values(groups).flatMap((g) => g.jobs).filter((j) => !j.label.startsWith('W-'));
const paired = measured.filter((j) => j.input._bench_codes_from);

// Escuta cega: por prompt, uma letra (A, B...) e as variações embaralhadas com semente fixa
// (data do adapter + id do prompt), para o nome não entregar a coluna nem mudar entre execuções.
const cols = ['base', ...checkpoints.flatMap((c) => SCALES.map((s) => `${c.name}--${pct(s)}`))];
function shuffled(items, seedText) {
  let a = createHash('sha256').update(seedText).digest().readUInt32LE(0);
  const rand = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
if (prompts.length > 26) {
  console.error('Mais de 26 prompts: a escuta cega usa uma letra por prompt.');
  process.exit(1);
}
const blind = new Map(); // label -> nome neutro
const blindRows = prompts.map((p, i) => {
  const letter = String.fromCharCode(65 + i);
  const names = shuffled(cols, `${stamp}:${p.id}`).map((col, k) => {
    const name = `${letter}${k + 1}`;
    blind.set(`${p.id}--${col}`, name);
    return { name, label: `${p.id}--${col}`, col };
  });
  return { p, letter, names };
});

log(
  `Estilo '${style}', adapter ${stamp} (perfil ${PROFILE_NAME}), checkpoint(s): ${checkpoints.map((c) => c.name).join(', ')}; ` +
    `${prompts.length} prompt(s), forças ${SCALES.join(', ')}, ${DURATION} s, seed ${SEED}` +
    (tag ? `, gatilho '${tag}'` : ', sem gatilho') + '.',
);
// Estimativa grosseira: ~10 min de boot/download + ~1 s de GPU por segundo de áudio no XL-SFT
// com 50 passos, mais ~2 min de carga por checkpoint. A linha de custo no fim é a real.
const estMin = 10 + (checkpoints.length + 1) * 2 + (measured.length * DURATION) / 60;
log(`${measured.length} faixa(s) medidas. Estimativa: ~${Math.round(estMin)} min de pod (~US$ ${((estMin / 60) * 0.45).toFixed(2)} numa GPU de 24 GB).`);
if (estMin > MAX_MIN) log(`AVISO: a estimativa passa do teto (--max-min=${MAX_MIN}). Aumente o teto ou corte prompts/forças.`);
log(
  `Pareamento: ${paired.length} faixa(s) com adapter reaproveitam os códigos da coluna sem adapter do mesmo prompt. ` +
    `Escuta cega: ${blind.size} nome(s) neutro(s) em cega/, mapa em gabarito.json.`,
);
if (!BENCH_OVERRIDES) {
  log("AVISO: o bench_run.py não aceita '_bench_overrides': o compasso da referência não é fixado e a fase 1 do LM pode sortear outro (a injeção dos códigos vale do mesmo jeito).");
}
if (!BENCH_CODES) {
  const msg = "o bench_run.py não aceita '_bench_audio_codes': sem isso o A/B não é pareado (cada coluna sortearia uma estrutura nova).";
  if (!SIMULATE) {
    console.error(`ERRO: ${msg}`);
    process.exit(1);
  }
  log(`AVISO: ${msg} Fora do --simular a rodada para aqui.`);
}

// Cada execução grava numa subpasta nova da pasta do adapter. A pasta do adapter pode já ter
// uma rodada (as antigas gravavam direto nela: resultados/, audio/, escuta.md), e o
// experimento-render.mjs lê dali os códigos do LM e os FLACs originais: uma rodada pareada
// por cima trocaria as faixas sem adapter por um sorteio novo e apagaria os códigos das com
// adapter (que agora rodam sem a fase 2). docs/benchmarks não vai para o git.
const adapterDir = join('docs', 'benchmarks', `lora-${style}`, stamp);
const outDir = join(adapterDir, `pareado-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`);
const nonEmpty = (dir) => existsSync(dir) && readdirSync(dir).length > 0;
if (nonEmpty(outDir)) {
  console.error(`ERRO: ${outDir} já existe e não está vazia. Rode de novo (o nome leva o segundo da execução).`);
  process.exit(1);
}
const previous = nonEmpty(adapterDir) ? readdirSync(adapterDir).filter((n) => n !== basename(outDir)).sort() : [];
log(`Saída: ${outDir} (pasta nova; nada é sobrescrito).`);
if (previous.length) {
  log(`Já existe em ${adapterDir}: ${previous.join(', ')}. Fica intacto (o experimento-render.mjs lê as rodadas antigas dali).`);
}
if (SIMULATE) {
  for (const j of measured) log(`  ${j.label}: ${j.description}`);
  process.exit(0);
}

const URL_TTL = (MAX_MIN + 30) * 60;
const adapterUrls = Object.fromEntries(
  await Promise.all(checkpoints.map(async (c) => [c.name, await presignGet(c.key, URL_TTL)])),
);

// --- O que roda dentro do pod ----------------------------------------------------

const POD_SCRIPT = String.raw`
set -u
mkdir -p /tmp/logs/out /tmp/logs/results /tmp/bench /tmp/adapters
T=/tmp/logs/timeline.txt
cd /app
(/app/.venv/bin/python -m http.server 8003 --directory /tmp/logs > /dev/null 2>&1 &)
echo "BOOT $(date +%s)" >> $T
echo "$BENCH_PAYLOAD_B64" | base64 -d | tar xz --no-same-owner -C /tmp/bench
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
if ! { fetch_model "" main && fetch_model "--model ${DIT}" dit; }; then
  echo "FAILED $(date +%s) download dos modelos travou (ver download-*.log)" >> $T
  sleep 7200
fi
echo "MODELS_READY $(date +%s)" >> $T

# Uma pasta por checkpoint, com UMA subpasta (o nome do estilo): o handler aceita um LoKr por vez.
fetch_adapter() {
  /app/.venv/bin/python - "$1" <<'PY'
import json, os, sys, urllib.request
cfg = json.load(open("/tmp/bench/adapters.json"))
dest = f"/tmp/adapters/{sys.argv[1]}/{cfg['style']}"
os.makedirs(dest, exist_ok=True)
with urllib.request.urlopen(cfg["urls"][sys.argv[1]], timeout=600) as res, open(f"{dest}/lokr_weights.safetensors", "wb") as f:
    while chunk := res.read(1 << 20):
        f.write(chunk)
PY
}

run_group() {
  LORA_DIR=""
  if [ "$1" != base ]; then
    if ! fetch_adapter $1 > /tmp/logs/adapter-$1.log 2>&1; then
      echo "GROUP_FAILED $1 $(date +%s) download do adapter" >> $T
      return 0
    fi
    echo "ADAPTER_READY $1 $(date +%s)" >> $T
    LORA_DIR=/tmp/adapters/$1
    # Os códigos do LM vêm do grupo base, que já rodou neste mesmo pod.
    if ! BENCH_DIR=/tmp/bench LOGS_DIR=/tmp/logs /app/.venv/bin/python /tmp/bench/parear.py $1 >> /tmp/logs/parear.log 2>&1; then
      echo "GROUP_FAILED $1 $(date +%s) pareamento dos códigos (ver parear.log)" >> $T
      return 0
    fi
  fi
  ( set -a; . /tmp/bench/dockerenv.sh; set +a
    ACESTEP_CONFIG_PATH=${DIT} ACESTEP_LORA_DIR=$LORA_DIR \
    BENCH_DIR=/tmp/bench LOGS_DIR=/tmp/logs PYTHONPATH=/tmp/bench \
    /app/.venv/bin/python /tmp/bench/bench_run.py $1 > /tmp/logs/group-$1.log 2>&1 ) \
    || echo "GROUP_FAILED $1 $(date +%s) ver group-$1.log" >> $T
}

source /tmp/bench/plan.sh
echo "ALL_DONE $(date +%s)" >> $T
sleep 7200
`;

// Roda no pod antes de cada grupo com adapter: troca o '_bench_codes_from' de cada job pelos
// códigos que o LM gerou na referência ('_bench_audio_codes') e fixa as metas que o LM
// escolheu lá (bpm/tom, se o prompt não trouxe; compasso, por '_bench_overrides'). Sem as
// metas a fase 1 do LM sorteia de novo e o DiT recebe outro condicionamento. Fonte dos
// códigos: o 'audio_codes' de results/<ref>.json (bench_run.py); se faltar, a linha
// 'Debug output text: <|audio_code_...' do group-<grupo>.log (loguru em DEBUG), casada com
// o '[bench] <ref>: ok em' seguinte. Job sem códigos sai do grupo: sem par, não compara nada.
const PAREAR_PY = String.raw`
import json
import os
import re
import sys
import time
from pathlib import Path

BENCH_DIR = Path(os.environ.get("BENCH_DIR", "/tmp/bench"))
LOGS_DIR = Path(os.environ.get("LOGS_DIR", "/tmp/logs"))
CODE = re.compile(r"<\|audio_code_\d+\|>")


def timeline(line):
    with open(LOGS_DIR / "timeline.txt", "a", encoding="utf-8") as fh:
        fh.write(f"{line} {int(time.time())}\n")


def codes_from_log(group):
    """{rótulo: [códigos do item 0, do item 1...]} a partir do log do grupo."""
    found, pending = {}, []
    path = LOGS_DIR / f"group-{group}.log"
    if not path.exists():
        return found
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "Debug output text: <|audio_code" in line:
            pending.append("".join(CODE.findall(line)))
            continue
        m = re.match(r"^\[bench\] (\S+): (ok em |ERRO)", line)
        if m:
            if m.group(2) == "ok em " and pending:
                found[m.group(1)] = pending
            pending = []
    return found


def main():
    group = sys.argv[1]
    runs_path = BENCH_DIR / "runs.json"
    runs = json.loads(runs_path.read_text(encoding="utf-8"))
    jobs = runs["groups"][group]["jobs"]
    logs = {}
    kept, n_paired, n_skipped = [], 0, 0
    for job in jobs:
        inp = job["input"]
        src = inp.get("_bench_codes_from")
        if not src:
            kept.append(job)
            continue
        ref_path = LOGS_DIR / "results" / f"{src}.json"
        ref = json.loads(ref_path.read_text(encoding="utf-8")) if ref_path.exists() else {}
        codes = ref.get("audio_codes") if ref.get("ok") else None
        if isinstance(codes, list):
            codes = codes[0] if codes else None
        origem = "resultado"
        if ref.get("ok") and not codes:
            ref_group = ref.get("group", "base")
            if ref_group not in logs:
                logs[ref_group] = codes_from_log(ref_group)
            codes = (logs[ref_group].get(src) or [None])[0]
            origem = "log"
        n = len(CODE.findall(codes or ""))
        if n == 0:
            n_skipped += 1
            print(f"[parear] {job['label']}: SEM códigos de {src} (referência ok={ref.get('ok')}); job fora do grupo", flush=True)
            timeline(f"JOB_SKIPPED {job['label']} sem códigos de {src}")
            continue
        inp["_bench_audio_codes"] = codes
        meta = (ref.get("output") or {}).get("metadata") or {}
        fixed = []
        for key in ("bpm", "keyscale"):
            if inp.get(key) in (None, "") and meta.get(key) not in (None, ""):
                inp[key] = meta[key]
                fixed.append(f"{key}={meta[key]}")
        if meta.get("timesignature"):
            inp["_bench_overrides"] = {**(inp.get("_bench_overrides") or {}), "timesignature": str(meta["timesignature"])}
            fixed.append(f"timesignature={meta['timesignature']}")
        n_paired += 1
        kept.append(job)
        print(f"[parear] {job['label']}: {n} códigos de {src} ({origem}); metas fixadas: {', '.join(fixed) or 'nenhuma'}", flush=True)
    runs["groups"][group]["jobs"] = kept
    runs_path.write_text(json.dumps(runs, ensure_ascii=False), encoding="utf-8")
    timeline(f"PAIRED {group} {n_paired} pareado(s), {n_skipped} sem par")
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;

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

function buildPayload() {
  const dir = join(tmpdir(), `sonora-testar-lora-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync('apps/gpu-worker/handler.py', join(dir, 'handler.py'));
  // O executor do benchmark de qualidade: importa o handler real e grava cada job.
  copyFileSync('scripts/benchmark-qualidade/bench_run.py', join(dir, 'bench_run.py'));
  writeFileSync(join(dir, 'runs.json'), JSON.stringify({ groups: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { jobs: g.jobs }])) }));
  writeFileSync(join(dir, 'adapters.json'), JSON.stringify({ style, urls: adapterUrls }));
  writeFileSync(join(dir, 'plan.sh'), Object.keys(groups).map((k) => `run_group ${k}`).join('\n') + '\n');
  writeFileSync(join(dir, 'dockerenv.sh'), dockerfileEnv());
  writeFileSync(join(dir, 'parear.py'), PAREAR_PY);
  execFileSync('tar', ['czf', 'payload.tgz', 'handler.py', 'bench_run.py', 'parear.py', 'runs.json', 'adapters.json', 'plan.sh', 'dockerenv.sh'], { cwd: dir });
  return readFileSync(join(dir, 'payload.tgz')).toString('base64');
}

// --- Orquestração (mesmo padrão do benchmark-qualidade.mjs) ----------------------

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

/**
 * Confere no log de um grupo com adapter se cada job usou os códigos injetados: com eles o
 * LM roda como 'dit' e pula a fase 2 (inference.py / llm_inference.py do ACE-Step). Se a
 * fase 1 ainda rodou, os códigos valeram mas o LM sorteou as metas (o compasso) de novo.
 */
function pairingFromLog(text) {
  const res = new Map();
  let seg = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[bench\] (\S+): (ok em |ERRO)/);
    if (m) {
      const has = (s) => seg.some((l) => l.includes(s));
      res.set(
        m[1],
        !has('(infer_type=dit)') || has('Phase 2')
          ? 'NAO-pareado'
          : has('Phase 1: Generating CoT metadata')
            ? 'codigos-fixos-metas-sorteadas'
            : 'pareado',
      );
      seg = [];
    } else if (line.startsWith('[bench] ')) {
      seg = [];
    } else {
      seg.push(line);
    }
  }
  return res;
}

/** O que o pareamento conferido diz das faixas com adapter geradas (null: ainda não conferido). */
function pairingSummary(pairing, done) {
  if (!pairing) return null;
  const st = paired.filter((j) => done.get(j.label)?.ok).map((j) => pairing.get(j.label) ?? 'sem-log');
  const count = (k) => st.filter((s) => s === k).length;
  const pareado = count('pareado');
  const metas = count('codigos-fixos-metas-sorteadas');
  return { total: st.length, pareado, metas, falhou: st.length - pareado - metas };
}

/** A tabela de escuta CEGA (escuta.md) e o mapa dos nomes (gabarito.json, à parte). */
function writeListeningSheet(done, pairing = null) {
  const cell = ({ name, label }) => {
    const r = done.get(label);
    if (!r) return `${name}: —`;
    return r.ok ? `[${name}](cega/${name}.flac)` : `${name}: ERRO`;
  };
  const sum = pairingSummary(pairing, done);
  const claim =
    'Todas as faixas de um prompt usam a mesma seed na difusão e os mesmos códigos do LM (a estrutura, sorteada uma vez ' +
    'na faixa sem adapter e reaproveitada nas outras): o que muda entre elas é o adapter e a força no DiT.';
  let pairingText;
  if (!sum) {
    pairingText = `${claim} O pareamento é conferido no log de cada grupo no fim da rodada.`;
  } else if (sum.falhou > 0) {
    pairingText =
      `Mesma seed na difusão em todas as faixas, mas **ATENÇÃO:** ${sum.falhou} de ${sum.total} faixa(s) com adapter NÃO ` +
      'reaproveitaram os códigos do LM (estrutura sorteada de novo): nelas a diferença não é só o adapter. ' +
      "Veja o campo 'pareamento' no gabarito.json antes de concluir.";
  } else if (sum.metas > 0) {
    pairingText =
      `${claim} Conferido no log: as ${sum.total} faixas com adapter usaram os códigos da referência, mas em ${sum.metas} ` +
      'o LM sorteou as metas de novo (o compasso pode ter mudado).';
  } else {
    pairingText = `${claim} Conferido no log: as ${sum.total} faixas com adapter usaram os códigos e as metas da referência.`;
  }
  const md = [
    `# Escuta cega do adapter '${style}' (${stamp})`,
    '',
    `Perfil ${PROFILE_NAME}, ${DURATION} s, seed ${SEED}` + (tag ? `, gatilho '${tag}'.` : '.'),
    pairingText,
    '',
    `Cada linha tem as ${cols.length} variações do prompt (sem adapter e ${cols.length - 1} com adapter) em ordem embaralhada. ` +
      'Ouça pela pasta cega/ e dê as notas ANTES de abrir o gabarito.json ou a pasta audio/ (que têm os nomes reais).',
    '',
    '| | prompt | faixas |',
    '|---|---|---|',
    ...blindRows.map((b) => `| ${b.letter} | ${b.p.id}${b.p.controle ? ' (controle)' : ''} | ${b.names.map(cell).join(' · ')} |`),
    '',
    '## Notas',
    '',
    'Nota de 1 a 5 e o instante (mm:ss) de cada queda de volume.',
    '',
    '| faixa | nota (1-5) | quedas de volume (mm:ss) | observações |',
    '|---|---|---|---|',
    ...blindRows.flatMap((b) => b.names.map((n) => `| ${n.name} | | | |`)),
    '',
    '## O que escutar',
    '',
    '- **Nos prompts do estilo:** alguma faixa se aproxima do som do dataset (timbres, arranjo, mixagem) sem perder a letra e a estrutura pedidas?',
    '- **No controle:** as faixas continuam soando como o que foi pedido? Se alguma puxar para o estilo do dataset, o adapter vaza e só deve ser ligado quando o usuário escolher o estilo.',
    '- **Força:** distorção, repetição de trechos do treino ou quedas de volume que aparecem só em algumas faixas do mesmo prompt (com a mesma estrutura) vêm do adapter ou da força.',
    '',
    ...prompts.map((p) => `- \`${p.id}\`: ${p.descricao}`),
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'escuta.md'), md);

  const faixas = {};
  for (const b of blindRows) {
    for (const n of b.names) {
      const job = measured.find((j) => j.label === n.label);
      faixas[n.name] = {
        prompt: b.p.id,
        coluna: n.col,
        rotulo: n.label,
        flac: `audio/${n.label}-0.flac`,
        lora_scale: job?.input.lora_scale ?? 0,
        codigos_de: job?.input._bench_codes_from ?? null,
        ...(job?.input._bench_codes_from && pairing ? { pareamento: pairing.get(n.label) ?? 'sem-log' } : {}),
        ok: done.get(n.label)?.ok ?? null,
      };
    }
  }
  const gabarito = {
    observacao: 'Mapa da escuta cega de escuta.md. Abrir só depois das notas.',
    estilo: style,
    adapter: stamp,
    perfil: PROFILE_NAME,
    embaralhamento: `mulberry32(sha256('${stamp}:<id do prompt>')), Fisher-Yates`,
    pareamento: sum,
    faixas,
  };
  writeFileSync(join(outDir, 'gabarito.json'), JSON.stringify(gabarito, null, 2) + '\n');
}

async function main() {
  mkdirSync(join(outDir, 'resultados'), { recursive: true });
  mkdirSync(join(outDir, 'audio'), { recursive: true });
  mkdirSync(join(outDir, 'cega'), { recursive: true });

  const pod = await runpod('POST', '/pods', {
    name: `sonora-testar-lora-${style}`,
    imageName: IMAGE,
    gpuTypeIds: GPUS,
    gpuTypePriority: 'custom',
    gpuCount: 1,
    cloudType: 'SECURE',
    containerDiskInGb: 120,
    volumeInGb: 0,
    minRAMPerGPU: 32,
    ports: ['8003/tcp'],
    env: { BENCH_PAYLOAD_B64: buildPayload(), PYTHONUNBUFFERED: '1' },
    dockerEntrypoint: ['bash', '-c'],
    dockerStartCmd: [POD_SCRIPT],
  });
  podId = pod.id;
  costPerHr = pod.costPerHr ?? null;
  createdAt = Date.now();
  log(`Pod ${podId} criado (US$ ${costPerHr ?? '?'}/h).`);

  let base = null;
  while (!base) {
    if (Date.now() - createdAt > 15 * 60_000) throw new Error('o pod não ganhou IP em 15 min (imagem presa no host)');
    await sleep(10_000);
    const p = await runpod('GET', `/pods/${podId}`);
    costPerHr ??= p.costPerHr ?? null;
    const port = p.portMappings?.['8003'];
    if (p.publicIp && port) base = `http://${p.publicIp}:${port}`;
  }
  log(`Pod no ar: ${base}`);

  const seen = new Set();
  const done = new Map();
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
      const failed = line.match(/^GROUP_FAILED (\S+)/);
      if (failed) {
        const which = line.includes('pareamento') ? 'parear.log' : `group-${failed[1]}.log`;
        const tail = (await fetchBytes(`${base}/${which}`))?.toString('utf8').trimEnd().split('\n').slice(-25).join('\n');
        log(`O checkpoint ${failed[1]} falhou. Fim do ${which}:\n${tail ?? '(sem log)'}`);
      }
      // Coluna com adapter cuja referência não gerou códigos: o parear.py tirou o job do grupo.
      const skipped = line.match(/^JOB_SKIPPED (\S+)/);
      if (skipped) {
        done.set(skipped[1], { ok: false, error: 'sem os códigos do LM da referência (job não rodou)' });
        writeListeningSheet(done);
      }
      const jobDone = line.match(/^JOB_DONE (\S+) (ok|ERRO)/);
      if (jobDone && !jobDone[1].startsWith('W-')) {
        const label = jobDone[1];
        const json = await fetchBytes(`${base}/results/${label}.json`);
        if (json) writeFileSync(join(outDir, 'resultados', `${label}.json`), json);
        const meta = json ? JSON.parse(json.toString('utf8')) : { ok: false };
        done.set(label, meta);
        if (!meta.ok) log(`${label}: ${String(meta.error).slice(0, 400)}`);
        for (const t of meta.output?.tracks ?? []) {
          const audio = await fetchBytes(`${base}/out/${t.storage_key}`, 300_000);
          if (audio) {
            writeFileSync(join(outDir, 'audio', t.storage_key), audio);
            // A cópia com o nome neutro da escuta cega (lote 1: uma faixa por job).
            if (blind.has(label) && t.storage_key === `${label}-0.flac`) writeFileSync(join(outDir, 'cega', `${blind.get(label)}.flac`), audio);
            log(`baixado ${t.storage_key} (${(audio.length / 1e6).toFixed(1)} MB)`);
          }
        }
        writeListeningSheet(done);
      }
      if (line.startsWith('ALL_DONE')) finished = true;
    }
  }

  const pairing = new Map();
  for (const g of Object.keys(groups)) {
    const txt = await fetchBytes(`${base}/group-${g}.log`);
    if (!txt) continue;
    writeFileSync(join(outDir, 'resultados', `group-${g}.log`), txt);
    if (g !== 'base') for (const [label, st] of pairingFromLog(txt.toString('utf8'))) pairing.set(label, st);
  }
  const parearLog = await fetchBytes(`${base}/parear.log`);
  if (parearLog) writeFileSync(join(outDir, 'resultados', 'parear.log'), parearLog);
  writeListeningSheet(done, pairing);
  const sum = pairingSummary(pairing, done);
  log(`Pareamento conferido no log: ${sum.pareado} pareada(s), ${sum.metas} com metas sorteadas de novo, ${sum.falhou} sem par (de ${sum.total}).`);
  if (sum.falhou > 0) process.exitCode = 1;
  const ok = [...done.values()].filter((r) => r.ok).length;
  log(`${ok} de ${measured.length} faixa(s) geradas. Escute às cegas pela tabela em ${join(outDir, 'escuta.md')} (o mapa está em gabarito.json).`);
  if (ok < measured.length) process.exitCode = 1;
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
