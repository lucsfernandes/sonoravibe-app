#!/usr/bin/env node
/**
 * Benchmark do ACE-Step 1.5 numa GPU de 24 GB da RunPod.
 *
 * Por que um Pod e não Serverless: serverless exige uma imagem nossa com
 * handler (trabalho da implementação). Um Pod roda a imagem OFICIAL numa GPU da
 * mesma classe do serverless e mede o que decide o custo:
 *   - segundos de GPU por música (warm)
 *   - tempo de carga dos modelos (o cold start de um worker)
 *
 * Garantia de custo: o pod é SEMPRE destruído no final — em sucesso, erro,
 * Ctrl+C ou ao estourar MAX_RUNTIME_MS.
 *
 * Uso:  node scripts/runpod-bench.mjs
 * Lê RUNPOD_API_KEY do .env.
 */

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

try {
  process.loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // segue com o ambiente do shell
}

const RUNPOD_KEY = process.env.RUNPOD_API_KEY;
if (!RUNPOD_KEY) {
  console.error('Faltou RUNPOD_API_KEY no .env.');
  process.exit(1);
}

const REST = 'https://rest.runpod.io/v1';
const MAX_RUNTIME_MS = 45 * 60 * 1000;
const SERVER_KEY = randomBytes(24).toString('hex');

/** Classe "24 GB" do serverless, da mais lenta para a mais rápida: estimativa conservadora. */
const GPU_PREFERENCE = ['NVIDIA RTX A5000', 'NVIDIA GeForce RTX 3090', 'NVIDIA L4'];

/**
 * Roda dentro do pod. Sobe um servidor de logs na 8003 (não há exec remoto),
 * baixa os pesos, sobe o servidor OpenRouter-compatível na 8002 com backend
 * vllm e, se o LM não carregar, reinicia com pt — sem LM o `thinking` é
 * ignorado em silêncio e o benchmark mediria a configuração errada.
 */
const POD_SCRIPT = String.raw`
set -u
mkdir -p /tmp/logs
T=/tmp/logs/timeline.txt
cd /app
(uv run python -m http.server 8003 --directory /tmp/logs > /dev/null 2>&1 &)
echo "BOOT $(date +%s)" >> $T
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader > /tmp/logs/gpu.txt 2>&1
uv run acestep-download > /tmp/logs/download.log 2>&1
echo "DOWNLOAD_DONE $(date +%s)" >> $T

start_server() {
  echo "SERVER_START_$1 $(date +%s)" >> $T
  ACESTEP_LM_BACKEND=$1 uv run acestep-openrouter --host 0.0.0.0 --port 8002 > /tmp/logs/server-$1.log 2>&1 &
  echo $! > /tmp/logs/server.pid
}

wait_init() {
  for i in $(seq 1 450); do
    grep -q "All models initialized" /tmp/logs/server-$1.log 2>/dev/null && return 0
    grep -q "Traceback" /tmp/logs/server-$1.log 2>/dev/null && return 1
    # Processo morreu (ex.: comando inexistente nesta versão da imagem): falha já.
    kill -0 $(cat /tmp/logs/server.pid) 2>/dev/null || return 1
    sleep 2
  done
  return 1
}

start_server vllm
if wait_init vllm && grep -q "LLM model loaded" /tmp/logs/server-vllm.log; then
  echo "READY_vllm $(date +%s)" >> $T
else
  echo "VLLM_FAILED $(date +%s)" >> $T
  kill $(cat /tmp/logs/server.pid) 2>/dev/null; sleep 5
  start_server pt
  wait_init pt && echo "READY_pt $(date +%s)" >> $T || echo "PT_FAILED $(date +%s)" >> $T
fi
wait
`;

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`.padStart(6);
const log = (msg) => console.log(`[${elapsed()}] ${msg}`);

async function runpod(method, path, body) {
  const res = await fetch(`${REST}${path}`, {
    method,
    headers: { Authorization: `Bearer ${RUNPOD_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RunPod ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

let podId = null;
let costPerHr = null;
let terminated = false;

async function terminate(reason) {
  if (!podId || terminated) return;
  terminated = true;
  log(`Destruindo pod ${podId} (${reason})...`);
  try {
    await runpod('DELETE', `/pods/${podId}`);
    log('Pod destruído.');
  } catch (err) {
    console.error(`\n!!! FALHA AO DESTRUIR O POD ${podId}: ${err.message}`);
    console.error('!!! Destrua manualmente em https://www.runpod.io/console/pods\n');
  }
  if (costPerHr) {
    const hours = (Date.now() - t0) / 3_600_000;
    log(`Custo aproximado do teste: $${(costPerHr * hours).toFixed(3)} (${costPerHr}/h)`);
  }
}

process.on('SIGINT', async () => {
  await terminate('Ctrl+C');
  process.exit(130);
});
const hardStop = setTimeout(async () => {
  await terminate('teto de 45 min');
  process.exit(2);
}, MAX_RUNTIME_MS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function runProbe(url, gpuTag, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/probe-acestep.mjs', ...extraArgs], {
      env: { ...process.env, ACESTEP_URL: url, ACESTEP_API_KEY: SERVER_KEY, ACESTEP_TAG: gpuTag },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function main() {
  log('Criando pod...');
  const pod = await runpod('POST', '/pods', {
    name: 'sonora-acestep-bench',
    imageName: 'ghcr.io/ace-step/ace-step-1.5:latest',
    gpuTypeIds: GPU_PREFERENCE,
    gpuCount: 1,
    cloudType: 'SECURE',
    containerDiskInGb: 60,
    volumeInGb: 0,
    ports: ['8002/tcp', '8003/tcp'],
    env: {
      ACESTEP_CONFIG_PATH: 'acestep-v15-turbo',
      // 24 GB comporta o LM 1.7B sem offload — é o candidato de produção.
      ACESTEP_LM_MODEL_PATH: 'acestep-5Hz-lm-1.7B',
      ACESTEP_OFFLOAD_TO_CPU: 'false',
      ACESTEP_OFFLOAD_DIT_TO_CPU: 'false',
      ACESTEP_LM_OFFLOAD_TO_CPU: 'false',
      OPENROUTER_API_KEY: SERVER_KEY,
      PYTHONUNBUFFERED: '1',
      TOKENIZERS_PARALLELISM: 'false',
    },
    dockerEntrypoint: ['bash', '-c'],
    dockerStartCmd: [POD_SCRIPT],
  });
  podId = pod.id;
  costPerHr = pod.costPerHr ?? null;
  log(`Pod ${podId} criado — GPU: ${pod.machine?.gpuDisplayName ?? pod.gpuTypeId ?? '?'} — $${costPerHr}/h`);

  // --- Espera IP público e portas ---------------------------------------------
  let ip = null;
  let ports = null;
  while (!ip || !ports?.['8002'] || !ports?.['8003']) {
    await sleep(5000);
    const info = await runpod('GET', `/pods/${podId}`);
    ip = info.publicIp || null;
    ports = info.portMappings || null;
    costPerHr = info.costPerHr ?? costPerHr;
  }
  const api = `http://${ip}:${ports['8002']}`;
  const logs = `http://${ip}:${ports['8003']}`;
  log(`Container de pé: API ${api} | logs ${logs}`);

  // --- Acompanha o boot pela timeline do próprio pod ---------------------------
  const seen = new Set();
  let ready = null;
  while (!ready) {
    await sleep(5000);
    const timeline = await fetchText(`${logs}/timeline.txt`);
    if (!timeline) continue;
    for (const line of timeline.trim().split('\n')) {
      if (!seen.has(line)) {
        seen.add(line);
        log(`pod: ${line}`);
      }
    }
    if (/READY_(vllm|pt)/.test(timeline)) ready = timeline.match(/READY_(vllm|pt)/)[1];
    if (/PT_FAILED/.test(timeline)) {
      const tail = (await fetchText(`${logs}/server-pt.log`)) ?? '';
      throw new Error(`Servidor não subiu nem com pt. Final do log:\n${tail.slice(-2000)}`);
    }
  }
  const gpu = ((await fetchText(`${logs}/gpu.txt`)) ?? '?').trim();
  log(`Pronto com backend ${ready} em ${gpu}`);

  const timeline = await fetchText(`${logs}/timeline.txt`);
  const ts = Object.fromEntries(
    timeline.trim().split('\n').map((l) => {
      const [k, v] = l.split(' ');
      return [k, Number(v)];
    }),
  );
  const serverStart = ts[`SERVER_START_${ready}`];
  const readyAt = ts[`READY_${ready}`];
  console.log('\n=== BOOT ===');
  console.log(`  download dos pesos (só no teste; em produção ficam na imagem): ${ts.DOWNLOAD_DONE - ts.BOOT}s`);
  console.log(`  carga dos modelos = cold start do worker:                        ${readyAt - serverStart}s`);

  // --- Gerações ---------------------------------------------------------------
  const gpuTag = `runpod-${gpu.split(',')[0].replace(/NVIDIA |GeForce /g, '').replace(/\s+/g, '').toLowerCase()}`;
  const runs = [
    { label: 'R1 thinking + duração automática (1ª chamada, inclui aquecimento)', args: ['--thinking', '--auto-duration'] },
    { label: 'R2 thinking + duração automática (quente)', args: ['--thinking', '--auto-duration'] },
    { label: 'R3 thinking + 270s (comparável ao teste local)', args: ['--thinking'] },
  ];

  console.log('\n=== GERAÇÕES ===');
  for (const run of runs) {
    log(run.label);
    const { code, out } = await runProbe(api, gpuTag, run.args);
    const pick = out
      .split('\n')
      .filter((l) => /HTTP|velocidade|Áudio salvo|Falhou|detail|Erro/.test(l))
      .map((l) => `        ${l.trim()}`)
      .join('\n');
    console.log(pick || out.slice(-800));
    if (code !== 0) log(`probe saiu com código ${code}`);
  }

  // --- Decomposição do tempo pelo log do servidor -----------------------------
  const serverLog = (await fetchText(`${logs}/server-${ready}.log`)) ?? '';
  const clean = serverLog.replace(/\x1b\[[0-9;]*m/g, '');
  console.log('\n=== FASES (log do servidor) ===');
  for (const line of clean.split('\n')) {
    const phase = line.match(/Phase (\d) completed in ([\d.]+)s/);
    if (phase) console.log(`  LM fase ${phase[1]}: ${Number(phase[2]).toFixed(1)}s`);
    const costs = line.match(/time_costs: (\{.*\})/);
    if (costs) {
      const diff = costs[1].match(/'diffusion_time_cost': ([\d.]+)/);
      const off = costs[1].match(/'offload_time_cost': ([\d.]+)/);
      console.log(
        `  difusão: ${diff ? Number(diff[1]).toFixed(1) : '?'}s | offload: ${off ? Number(off[1]).toFixed(1) : '?'}s`,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(`\nERRO: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(hardStop);
    await terminate('fim do teste');
  });
