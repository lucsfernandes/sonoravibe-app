#!/usr/bin/env node
/**
 * Rotula e treina um LoKr do ACE-Step (XL-SFT) num pod da RunPod, com o dataset
 * do bucket privado (enviado por subir-dataset.mjs).
 *
 * Uso:
 *   node scripts/lora/treinar-lora.mjs <estilo> --so-rotular      rotula e para (revise as letras)
 *   node scripts/lora/treinar-lora.mjs <estilo>                   rotula (ou usa os rótulos revisados) e treina
 *   opções: --modelo=sft|turbo  --epocas=500  --max-min=120  --salvar-a-cada=10  --lr=0.03  --tag=<gatilho>
 *           --dim=64  --alpha=128  --rotular-de-novo
 *
 * --modelo: o trainer embutido do ACE-Step é feito para o TURBO (sorteia 8 timesteps fixos e não
 * faz CFG dropout). Com 'sft' (padrão), o pod remenda o trainer para treinar como o XL-SFT foi
 * treinado: t = máximo de dois sorteios logit-normais (mu/sigma do config.json), como o sample_t_r
 * do modelo, e 15% de condição nula. Com 'turbo', treina no XL-turbo e o remendo troca a lista
 * do trainer pelos 8 timesteps que a inferência turbo da produção de fato usa; o adapter vale
 * só para a v1/v1.5.
 *
 * --max-min é o teto do TREINO. Medido no XL-SFT com 20 faixas numa GPU de 48 GB: ~72 s por
 * época, ou seja, 100 épocas em 2 h. A linha ETA do pod projeta o total logo no começo.
 *
 * Rótulos: saem em lora/<estilo>/rotulos/dataset.json. Para corrigir letras, BPM
 * ou tom, edite esse arquivo e suba como lora/<estilo>/rotulos/dataset.revisado.json:
 * o treino seguinte usa o revisado e não rotula de novo.
 *
 * O pod usa a MESMA imagem do worker (digest fixo), e é SEMPRE destruído: em
 * sucesso, erro, Ctrl+C ou no teto de tempo. Ele nunca recebe credenciais do R2,
 * só URLs assinadas.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIO_EXT, assertConfig, checkBucket, getText, list, presignGet, presignPut, slug } from './r2.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${def}`).split('=')[1];
const styleArg = args.find((a) => !a.startsWith('--'));
if (!styleArg) {
  console.error('Uso: node scripts/lora/treinar-lora.mjs <estilo> [--so-rotular] [--epocas=500] [--max-min=120] [--tag=x]');
  process.exit(1);
}
const style = slug(styleArg);
const LABEL_ONLY = args.includes('--so-rotular');
const EPOCHS = Number(opt('epocas', 500));
const MAX_MIN = Number(opt('max-min', 120));
// De 10 em 10 épocas: com o antigo padrão 100, um treino de 60 épocas não gravava checkpoint
// nenhum, e não dava para comparar épocas na escuta.
const SAVE_EVERY = Number(opt('salvar-a-cada', 10));
const TAG = opt('tag', '');
// LoKr do LyCORIS (lokr.py, lido na 3.4.0 do venv local; a versão da imagem não é fixada): com
// factor -1 o w2 de cada Linear do XL vira matriz CHEIA quando dim >= metade do maior fator
// (128 nas camadas de 9728 e 15360, 64 nas de 2560 e 4096). Com w1 e w2 cheios o LyCORIS força
// alpha = dim, ou seja, escala 1: com dim 64 o alpha é ignorado (o 128 abaixo não faz nada).
// Abaixo de 64 parte das camadas passa a ser decomposta, com escala alpha/dim (128/16 = 8x!).
const LOKR_FULL_DIM = 64;
const DIM = Number(opt('dim', 64));
const ALPHA = Number(opt('alpha', 128));
// 0,03 é o padrão do tutorial, mas o modern-metal (9 faixas, XL-SFT) divergiu com ele na época
// 30: o loss foi de ~0,2 para ~0,43 e não voltou. Ver docs/LORA.md.
const LR = Number(opt('lr', 0.03));
const FAMILY = opt('modelo', 'sft');
if (!['sft', 'turbo'].includes(FAMILY)) {
  console.error('--modelo: sft ou turbo.');
  process.exit(1);
}
if (!LABEL_ONLY) {
  if (!Number.isInteger(EPOCHS) || EPOCHS < 1 || !Number.isInteger(SAVE_EVERY) || SAVE_EVERY < 1) {
    console.error('--epocas e --salvar-a-cada: inteiros maiores que zero.');
    process.exit(1);
  }
  // Sem checkpoint intermediário, um teto de tempo ou uma queda do pod perdem o treino inteiro.
  if (Math.floor(EPOCHS / SAVE_EVERY) === 0) {
    console.error(
      `--salvar-a-cada=${SAVE_EVERY} é maior que --epocas=${EPOCHS}: nenhum checkpoint seria gravado.\n` +
        `Use --salvar-a-cada=${Math.max(1, Math.floor(EPOCHS / 5))} (ou outro valor <= ${EPOCHS}).`,
    );
    process.exit(1);
  }
  if (!Number.isInteger(DIM) || DIM < 1 || !(ALPHA > 0)) {
    console.error('--dim: inteiro maior que zero; --alpha: número maior que zero.');
    process.exit(1);
  }
  if (DIM < LOKR_FULL_DIM && ALPHA !== DIM) {
    console.warn(
      `AVISO: --dim=${DIM} fica abaixo de ${LOKR_FULL_DIM} (limiar de matriz cheia do LyCORIS) e --alpha=${ALPHA} != dim:\n` +
        `as camadas decompostas treinam com escala ${ALPHA}/${DIM} = ${(ALPHA / DIM).toFixed(2)}x, e as cheias com 1x.\n` +
        `Para a mesma escala em todas, passe --alpha=${DIM}.`,
    );
  }
}
// Sem passo novo na linha do tempo por este tempo = pod travado. Cabe uma tentativa de
// download de 15 min (cada falha registra DOWNLOAD_RETRY e reinicia a contagem).
const STALL_MIN = 20;

const RUNPOD_KEY = process.env.RUNPOD_API_KEY;
if (!RUNPOD_KEY) {
  console.error('Faltou RUNPOD_API_KEY no .env.');
  process.exit(1);
}

// O mesmo digest do apps/gpu-worker/Dockerfile: treino e inferência no mesmo código do ACE-Step.
const IMAGE = 'ghcr.io/ace-step/ace-step-1.5@sha256:95652cd780c78a1b1a7f6f0335530430f0ae53d96c7c12d59f9f39fa23d38567';
const DIT = FAMILY === 'turbo' ? 'acestep-v15-xl-turbo' : 'acestep-v15-xl-sft';
// Treino em 48 GB por folga: o trainer do ACE-Step converte o decoder do XL-SFT para fp32
// (bf16-mixed). Houve CUDA OOM em 24 GB, mas com o LM recarregando junto (corrida corrigida
// em train_run.py), então não está provado que 24 GB não bastam: confira o vram_pico das
// linhas EPOCH antes de devolver as GPUs de 24 GB ao treino. Rotular cabe em 24 GB.
const GPUS_24 = ['NVIDIA L4', 'NVIDIA RTX A5000', 'NVIDIA GeForce RTX 3090', 'NVIDIA GeForce RTX 4090'];
const GPUS_48 = ['NVIDIA A40', 'NVIDIA RTX A6000', 'NVIDIA L40S', 'NVIDIA L40', 'NVIDIA RTX 6000 Ada Generation'];
const GPUS = LABEL_ONLY ? [...GPUS_24, ...GPUS_48] : GPUS_48;
const REST = 'https://rest.runpod.io/v1';
const URL_TTL = Math.max(2 * 3600, (MAX_MIN + 30) * 60);

const t0 = Date.now();
const log = (msg) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(5)}s] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Entrada: o dataset no bucket privado ------------------------------------

assertConfig();
await checkBucket();

const prefix = `lora/${style}`;
const objects = await list(`${prefix}/audio/`);
const audio = objects.filter((o) => AUDIO_EXT.test(o.key));
if (audio.length === 0) {
  console.error(`Nenhum áudio em ${prefix}/audio/. Rode antes: node scripts/lora/subir-dataset.mjs <pasta> ${style} --tenho-direitos`);
  process.exit(1);
}
// O tutorial do ACE-Step fala em 10–20 faixas (até ~100). Centenas multiplicam rotulagem
// e treino (cada época passa por todas): horas de GPU por um ganho que não foi medido.
if (audio.length > 100 && !args.includes('--muitas-faixas')) {
  console.error(
    `'${style}' tem ${audio.length} faixas; o recomendado é 10–20 (no máximo ~100) por estilo.\n` +
      'Rotular e treinar tudo leva horas de GPU. Escolha as mais representativas e suba só elas\n' +
      '(subir-dataset.mjs <pasta> <estilo> --tenho-direitos --substituir), ou confirme com --muitas-faixas.',
  );
  process.exit(1);
}
const manifest = JSON.parse((await getText(`${prefix}/manifesto.json`)) ?? '{}');
if (!manifest.rightsConfirmed) {
  console.error('O manifesto não tem a confirmação de direitos. Suba o dataset de novo com --tenho-direitos.');
  process.exit(1);
}
const lyrics = objects.filter((o) => o.key.endsWith('.lyrics.txt'));
const reviewed = (await list(`${prefix}/rotulos/dataset.revisado.json`)).length > 0;
// Sem revisado, reaproveita os rótulos de um --so-rotular anterior (não paga a rotulagem
// duas vezes), desde que cubram as mesmas faixas. --rotular-de-novo força refazer.
const previous = JSON.parse((await getText(`${prefix}/rotulos/dataset.json`)) ?? 'null');
const reusePrevious =
  !reviewed && !LABEL_ONLY && !args.includes('--rotular-de-novo') && previous?.samples?.length === audio.length;
const labelsKey = reviewed ? 'rotulos/dataset.revisado.json' : reusePrevious ? 'rotulos/dataset.json' : null;

const inputs = await Promise.all(
  [...audio, ...lyrics].map(async (o) => ({ name: o.key.split('/').pop(), url: await presignGet(o.key, URL_TTL) })),
);
const stamp = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${FAMILY}`;
const job = {
  style,
  customTag: TAG,
  // Transcreve só se faltar letra em alguma faixa; letra enviada vale mais que a transcrição.
  transcribeLyrics: lyrics.length < audio.length,
  labelOnly: LABEL_ONLY,
  inputs,
  reviewedDatasetUrl: labelsKey ? await presignGet(`${prefix}/${labelsKey}`, URL_TTL) : null,
  labelsPutUrl: await presignPut(`${prefix}/rotulos/${labelsKey ? `usado-${stamp}` : 'dataset'}.json`, URL_TTL),
  weightsPutUrl: await presignPut(`${prefix}/adapters/${stamp}/lokr_weights.safetensors`, URL_TTL),
  // Cada checkpoint sobe assim que é gravado: o teto de tempo ou uma queda do pod não jogam
  // o treino fora, e dá para comparar épocas na escuta.
  checkpointPutUrls: Object.fromEntries(
    await Promise.all(
      Array.from({ length: Math.floor(EPOCHS / SAVE_EVERY) }, (_, i) => (i + 1) * SAVE_EVERY).map(async (epoch) => [
        epoch,
        await presignPut(`${prefix}/adapters/${stamp}/epoca-${epoch}/lokr_weights.safetensors`, URL_TTL),
      ]),
    ),
  ),
  // Padrões do tutorial do ACE-Step para LoKr, MENOS o DoRA: a rota start_lokr o liga por
  // padrão, e com DoRA o multiplicador do LyCORIS só interpola a magnitude (com 0 o delta fica
  // inteiro). O adapter não desligaria nem teria força ajustável, e o handler recusa carregá-lo.
  lokr: {
    // dim/alpha: ver LOKR_FULL_DIM lá em cima (com dim 64 o alpha é ignorado).
    train_epochs: EPOCHS, learning_rate: LR, lokr_linear_dim: DIM, lokr_linear_alpha: ALPHA,
    lokr_weight_decompose: false, save_every_n_epochs: SAVE_EVERY,
  },
  maxTrainS: MAX_MIN * 60,
};
log(
  `Estilo '${style}': ${audio.length} faixa(s), ${lyrics.length} com letra; ` +
    (reviewed ? 'usando os rótulos REVISADOS. ' : reusePrevious ? 'reaproveitando os rótulos do --so-rotular. ' : `rotulagem automática${job.transcribeLyrics ? ' com transcrição de letra' : ''}. `) +
    (LABEL_ONLY
      ? 'Só rotular.'
      : `Treino LoKr no ${DIT}, ${EPOCHS} épocas (checkpoint a cada ${SAVE_EVERY}), lr ${LR}, dim ${DIM}` +
        (FAMILY === 'sft'
          ? ', trainer remendado (t = máx. de 2 logit-normais + CFG dropout).'
          : ', trainer remendado (timesteps da inferência turbo).')),
);

// --- O que roda dentro do pod ------------------------------------------------

// O LM só serve para rotular. Com rótulos prontos ele nem sobe: o servidor fica de pé mais
// rápido e o treino não disputa a GPU com ele (ver wait_restore em train_run.py).
const NEEDS_LLM = job.reviewedDatasetUrl ? 'false' : 'true';

// O trainer embutido (acestep/training/trainer.py no dce6214) sorteia t uniforme entre os 8
// valores de TURBO_SHIFT3_TIMESTEPS (1,0 a 0,3) e nunca troca a condição pela nula. Os dois
// remendos abaixo inserem um desvio em sample_discrete_timestep, ligado por variável de ambiente
// (sem a variável, o trainer sorteia como antes). Cada pod aplica só o da sua família; as
// variáveis vão para /tmp/job/trainer_fix.env, que o POD_SCRIPT carrega antes de subir o servidor.
// As âncoras são o texto exato do dce6214: se o ACE-Step mudar, o assert derruba o pod (FAILED).
const TRAINER_PATCH_HEAD = String.raw`
import importlib.util, json, pathlib
path = pathlib.Path(importlib.util.find_spec("acestep.training.trainer").origin)
src = path.read_text()
old_t = "    t = timesteps_tensor[indices]\n"
old_s = "            t, _ = sample_discrete_timestep(bsz, self.timesteps_tensor)\n"
assert src.count(old_t) == 1, "sample_discrete_timestep mudou"
# training_step do PreprocessedLoRAModule e do módulo LoKr (o que o pod usa)
assert src.count(old_s) == 2, "training_step mudou"
`;

// XL-SFT: no XL-SFT a inferência anda 50 passos até 0 com CFG; o adapter atuava em níveis de
// ruído que nunca viu e no ramo incondicional sem treino, o que soou robótico (docs/LORA.md).
// O remendo faz o treino igual ao forward do próprio modelo (modeling_acestep_v15_xl_base.py):
// sample_t_r sorteia t e r como sigmoid(randn*sigma + mu) e fica com t = max(t, r); com
// use_meanflow=False o r passa a ser t (o "r = t" do trainer já faz isso). O sorteio sai no
// dtype do trainer (bf16 na GPU), como o modelo faz no dtype dos latentes. Mais o CFG dropout
// do mesmo forward: 15% das amostras com null_condition_emb no lugar da condição.
const SFT_TRAINER_PATCH = String.raw`
/app/.venv/bin/python - <<'PATCH' >> /tmp/logs/patch.log 2>&1 || { echo "FAILED $(date +%s) remendo do trainer falhou (ver patch.log)" >> $T; sleep 7200; }
${TRAINER_PATCH_HEAD}
cfg = json.load(open("/app/checkpoints/${DIT}/config.json"))
mu, sigma = float(cfg["timestep_mu"]), float(cfg["timestep_sigma"])
if "_sonora_sft_t" not in src:
    src = src.replace(old_t, old_t + (
        "    if __import__('os').environ.get('SONORA_TS_MU') is not None:\n"
        "        t = _sonora_sft_t(bsz, timesteps_tensor)\n"
    ))
    src = src.replace(old_s, old_s + "            encoder_hidden_states = _sonora_cfg_drop(self.model, encoder_hidden_states)\n")
    src += (
        "\n\ndef _sonora_sft_t(bsz, ref):\n"
        "    # sample_t_r do XL-SFT com use_meanflow=False: t = max de dois logit-normais, r = t\n"
        "    mu = float(__import__('os').environ['SONORA_TS_MU'])\n"
        "    sigma = float(__import__('os').environ['SONORA_TS_SIGMA'])\n"
        "    a = torch.sigmoid(torch.randn((bsz,), device=ref.device, dtype=ref.dtype) * sigma + mu)\n"
        "    b = torch.sigmoid(torch.randn((bsz,), device=ref.device, dtype=ref.dtype) * sigma + mu)\n"
        "    return torch.maximum(a, b)\n"
        "\n\ndef _sonora_cfg_drop(model, encoder_hidden_states):\n"
        "    ratio = float(__import__('os').environ.get('SONORA_CFG_DROPOUT', '0'))\n"
        "    if ratio <= 0:\n"
        "        return encoder_hidden_states\n"
        "    null = getattr(model, 'null_condition_emb', None)\n"
        "    if null is None:\n"
        "        raise RuntimeError('modelo sem null_condition_emb: CFG dropout impossivel')\n"
        "    keep = (torch.rand((encoder_hidden_states.shape[0],), device=encoder_hidden_states.device) >= ratio).view(-1, 1, 1)\n"
        "    return torch.where(keep, encoder_hidden_states, null.to(encoder_hidden_states.dtype).expand_as(encoder_hidden_states))\n"
    )
    path.write_text(src)
open("/tmp/job/trainer_fix.env", "a").write(
    f"export SONORA_TS_MU={mu} SONORA_TS_SIGMA={sigma} SONORA_CFG_DROPOUT=0.15\n")
print("trainer remendado (sft):", path, "mu", mu, "sigma", sigma)
PATCH
echo "SFT_FIX $(date +%s) t = máx. de 2 logit-normais + CFG dropout 0.15 ($(cat /tmp/job/trainer_fix.env))" >> $T
`;

// XL-turbo: a lista do trainer não é a que a produção usa. O handler manda TURBO_TIMESTEPS
// (apps/gpu-worker/handler.py) e o generate_audio do XL-turbo troca cada valor pelo mais
// próximo de VALID_TIMESTEPS; todo job turbo dos logs mostra "timesteps mapped to nearest valid
// values: [...] -> [0.9545..., 0.7692..., 0.625, 0.5, 0.4, 0.3, 0.2222..., 0.125]". Só 0,9545,
// 0,5 e 0,3 coincidem com a lista do trainer: o adapter treinava em 1,0/0,9/0,83/0,75/0,64,
// que a inferência nunca visita, e nunca via 0,77/0,4/0,22/0,125. O tensor sai no dtype do
// trainer (bf16 na GPU), o mesmo arredondamento do t_schedule da inferência. Turbo não usa CFG
// na inferência, então aqui não há CFG dropout. Se TURBO_TIMESTEPS mudar no handler, refaça esta lista.
const TURBO_INFER_TIMESTEPS = [0.9545454545454546, 0.7692307692307693, 0.625, 0.5, 0.4, 0.3, 0.2222222222222222, 0.125];
const TURBO_TRAINER_PATCH = String.raw`
/app/.venv/bin/python - <<'PATCH' >> /tmp/logs/patch.log 2>&1 || { echo "FAILED $(date +%s) remendo do trainer falhou (ver patch.log)" >> $T; sleep 7200; }
${TRAINER_PATCH_HEAD}
old_l = "TURBO_SHIFT3_TIMESTEPS = [\n    1.0,\n    0.9545454545454546,\n    0.9,\n    0.8333333333333334,\n    0.75,\n    0.6428571428571429,\n    0.5,\n    0.3,\n]\n"
assert src.count(old_l) == 1, "TURBO_SHIFT3_TIMESTEPS mudou"
if "_sonora_turbo_t" not in src:
    src = src.replace(old_t, old_t + (
        "    if __import__('os').environ.get('SONORA_TURBO_TS') is not None:\n"
        "        t = _sonora_turbo_t(bsz, timesteps_tensor)\n"
    ))
    src += (
        "\n\ndef _sonora_turbo_t(bsz, ref):\n"
        "    # sorteio uniforme entre os timesteps que a inferencia turbo da producao usa\n"
        "    ts = [float(x) for x in __import__('os').environ['SONORA_TURBO_TS'].split(',')]\n"
        "    v = torch.tensor(ts, device=ref.device, dtype=ref.dtype)\n"
        "    return v[torch.randint(0, v.shape[0], (bsz,), device=v.device)]\n"
    )
    path.write_text(src)
open("/tmp/job/trainer_fix.env", "a").write("export SONORA_TURBO_TS=${TURBO_INFER_TIMESTEPS.join(',')}\n")
print("trainer remendado (turbo):", path)
PATCH
echo "TURBO_FIX $(date +%s) timesteps da inferência turbo ($(cat /tmp/job/trainer_fix.env))" >> $T
`;

const POD_SCRIPT = String.raw`
set -u
mkdir -p /tmp/logs /tmp/job
T=/tmp/logs/timeline.txt
cd /app
(/app/.venv/bin/python -m http.server 8003 --directory /tmp/logs > /dev/null 2>&1 &)
echo "BOOT $(date +%s)" >> $T
# --no-same-owner: o tar feito no Windows traz um uid que não existe no container.
echo "$LORA_PAYLOAD_B64" | base64 -d | tar xz --no-same-owner -C /tmp/job
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader > /tmp/logs/gpu.txt 2>&1
echo "GPU $(date +%s) $(head -1 /tmp/logs/gpu.txt)" >> $T
# Download com prazo e novas tentativas: há hosts em que o Hugging Face trava no meio
# (visto: 6 de 28 arquivos parados por 16 min). O cache do HF retoma de onde parou.
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
# Bug do ACE-Step no commit fixado (dce6214): as rotas /v1/dataset/auto_label(_async)
# passam chunk_size, batch_size e sample_labeled_callback a label_all_samples(), que
# não os aceita. O remendo só faz a função aceitar (e ignorar) esses argumentos extras.
/app/.venv/bin/python - <<'PATCH' >> /tmp/logs/patch.log 2>&1 || { echo "FAILED $(date +%s) remendo do label_all falhou (ver patch.log)" >> $T; sleep 7200; }
import importlib.util, pathlib
path = pathlib.Path(importlib.util.find_spec("acestep.training.dataset_builder_modules.label_all").origin)
src = path.read_text()
old = "        progress_callback=None,\n    ) -> Tuple[List[AudioSample], str]:"
if "**_ignored" not in src:
    assert src.count(old) == 1, "assinatura de label_all_samples mudou"
    path.write_text(src.replace(old, "        progress_callback=None,\n        **_ignored,\n    ) -> Tuple[List[AudioSample], str]:"))
print("label_all remendado:", path)
PATCH
${LABEL_ONLY ? '' : FAMILY === 'sft' ? SFT_TRAINER_PATCH : TURBO_TRAINER_PATCH}echo "PATCHED $(date +%s)" >> $T
[ -f /tmp/job/trainer_fix.env ] && . /tmp/job/trainer_fix.env
ACESTEP_CONFIG_PATH=${DIT} ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B ACESTEP_INIT_LLM=${NEEDS_LLM} \
ACESTEP_NO_INIT=false ACESTEP_OFFLOAD_TO_CPU=true ACESTEP_LM_BACKEND=vllm PYTHONUNBUFFERED=1 \
  /app/.venv/bin/python -m uvicorn acestep.api_server:app --host 127.0.0.1 --port 8001 --workers 1 \
  > /tmp/logs/server.log 2>&1 &
/app/.venv/bin/python /tmp/job/train_run.py > /tmp/logs/train.log 2>&1 || true
grep -q ALL_DONE $T || echo "FAILED $(date +%s) ver train.log/server.log" >> $T
sleep 7200
`;

function buildPayload() {
  const dir = join(tmpdir(), `sonora-lora-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync('scripts/lora/train_run.py', join(dir, 'train_run.py'));
  writeFileSync(join(dir, 'job.json'), JSON.stringify(job));
  execFileSync('tar', ['czf', 'payload.tgz', 'train_run.py', 'job.json'], { cwd: dir });
  return readFileSync(join(dir, 'payload.tgz')).toString('base64');
}

// --- Orquestração (mesmo padrão do benchmark-qualidade.mjs) ------------------

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
// Teto total: o do treino mais a folga de boot, download e rotulagem.
setTimeout(async () => {
  await terminate('teto de tempo');
  process.exit(2);
}, (MAX_MIN + 45) * 60_000);

async function fetchText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function main() {
  const pod = await runpod('POST', '/pods', {
    name: `sonora-lora-${style}`,
    imageName: IMAGE,
    gpuTypeIds: GPUS,
    gpuTypePriority: 'custom',
    cloudType: 'SECURE',
    gpuCount: 1,
    containerDiskInGb: 120,
    volumeInGb: 0,
    minRAMPerGPU: 32,
    ports: ['8003/tcp'],
    dockerEntrypoint: ['bash', '-c'],
    dockerStartCmd: [POD_SCRIPT],
    env: { LORA_PAYLOAD_B64: buildPayload() },
  });
  podId = pod.id;
  costPerHr = pod.costPerHr ?? null;
  createdAt = Date.now();
  log(`Pod ${podId} criado (US$ ${costPerHr ?? '?'}/h).`);

  let base = null;
  const ipDeadline = Date.now() + 15 * 60_000;
  while (!base) {
    if (Date.now() > ipDeadline) throw new Error('o pod não ganhou IP em 15 min');
    await sleep(10_000);
    const p = await runpod('GET', `/pods/${podId}`);
    costPerHr ??= p.costPerHr ?? null;
    const port = p.portMappings?.['8003'];
    if (p.publicIp && port) base = `http://${p.publicIp}:${port}`;
  }
  log(`Pod no ar: ${base}`);

  let seen = 0;
  let partial = null;
  let lastContact = Date.now();
  let lastProgress = Date.now();
  for (;;) {
    await sleep(15_000);
    const timeline = await fetchText(`${base}/timeline.txt`);
    if (timeline === null) {
      if (Date.now() - lastContact > 10 * 60_000) throw new Error('o pod parou de responder por 10 min');
      continue;
    }
    lastContact = Date.now();
    const lines = timeline.trim().split('\n').filter(Boolean);
    for (const line of lines.slice(seen)) log(`pod: ${line}`);
    if (lines.length > seen) lastProgress = Date.now();
    seen = lines.length;
    // Pod vivo mas sem passo novo (download, rotulagem, época): não paga GPU parada.
    if (Date.now() - lastProgress > STALL_MIN * 60_000) {
      throw new Error(`o pod ficou ${STALL_MIN} min sem avançar (último passo: ${lines.at(-1) ?? 'nenhum'})`);
    }
    if (lines.some((l) => l.startsWith('FAILED'))) {
      const tail = async (file, n) => (await fetchText(`${base}/${file}`))?.trimEnd().split('\n').slice(-n).join('\n') ?? '(sem log)';
      throw new Error(
        `o pod falhou. Fim do train.log:\n${await tail('train.log', 15)}\n\nFim do server.log:\n${await tail('server.log', 40)}`,
      );
    }
    partial = lines.find((l) => l.startsWith('PARTIAL')) ?? null;
    if (lines.some((l) => l.startsWith('ALL_DONE'))) break;
  }

  if (partial) {
    log(`TREINO INCOMPLETO (${partial.split(' ').slice(2).join(' ')}). Checkpoints em ${prefix}/adapters/${stamp}/epoca-N/; não há lokr_weights.safetensors final.`);
  } else if (LABEL_ONLY) {
    log(`Rótulos em ${prefix}/rotulos/dataset.json. Revise as letras e suba como ${prefix}/rotulos/dataset.revisado.json, ou treine direto.`);
  } else {
    log(`Adapter em ${prefix}/adapters/${stamp}/lokr_weights.safetensors (checkpoints em epoca-N/ na mesma pasta).`);
  }
}

try {
  await main();
  await terminate('fim');
} catch (err) {
  console.error(`\nERRO: ${err.message}`);
  await terminate('erro');
  process.exit(1);
}
process.exit(0);
