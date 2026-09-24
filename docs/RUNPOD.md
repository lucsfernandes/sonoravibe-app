# RunPod — criar o endpoint do ACE-Step

Este documento existe para responder uma pergunta: **onde fica o `RUNPOD_ENDPOINT_ID`?**
Resposta curta: ele não existe até você criar o endpoint. Não é um valor que se procura na
conta — é o identificador que a RunPod devolve quando o endpoint é criado.

O resto do arquivo é como criar.

---

## Por que isso importa

Hoje o motor em produção é o **Lyria 3** (via OpenRouter). Ele entrega até ~3 minutos e não
aceita duração como parâmetro — ela vai como sugestão de texto dentro do prompt. Por isso
`ENGINE_MAX_DURATION_SECONDS` (em `packages/shared/src/plans.ts`) limita a 180 s o que os
planos anunciam: sem esse teto, Pro e Premier venderiam 4 e 6 minutos que o motor não entrega.

O **ACE-Step 1.5** chega aos 480 s (o produto para em 360 s, o teto de 6 min de
`MAX_DURATION_SECONDS`). Ele roda na RunPod porque precisa de GPU e escala a zero —
o VPS não tem GPU, e uma máquina com GPU ligada o tempo todo custaria mais que a receita.

Quando o endpoint existir:

1. Coloque `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` (turbo: v1 e v1.5) e
   `RUNPOD_ENDPOINT_ID_SFT` (SFT: v2.0 e v2.5) nos secrets do GitHub.
2. Mude `MUSIC_PROVIDER` para `acestep` no ConfigMap do worker.
3. Suba `ENGINE_MAX_DURATION_SECONDS` para `480` — e os limites por plano voltam a valer
   sozinhos, sem mais nenhuma mudança.

---

## 1. Publicar as duas imagens

A RunPod puxa a imagem de um registry; ela não constrói do seu repositório. São **duas imagens**,
uma por família de modelo, do mesmo Dockerfile (um worker carrega um DiT só, e os dois XL juntos
não cabem numa GPU de 24 GB):

```bash
docker build --build-arg DIT_MODEL=acestep-v15-xl-turbo -t lucsfernandes/sonora-gpu-worker:v2-turbo apps/gpu-worker
docker build --build-arg DIT_MODEL=acestep-v15-xl-sft   -t lucsfernandes/sonora-gpu-worker:v2-sft   apps/gpu-worker
docker push lucsfernandes/sonora-gpu-worker:v2-turbo
docker push lucsfernandes/sonora-gpu-worker:v2-sft
```

| Imagem | Versões do produto | Pesos |
|---|---|---|
| `v2-turbo` | v1 e v1.5 | ~30 GB (XL-turbo ~20 GB em fp32 + modelo principal ~10 GB) |
| `v2-sft` | v2.0 e v2.5 | ~30 GB (XL-SFT ~20 GB em fp32 + modelo principal ~10 GB) |

Cada build pede ~70 GB livres em disco e o primeiro push demora. Um runner padrão do GitHub
Actions não comporta: construa de uma máquina com disco. Passos e reescrita do caption de cada
versão vão no pedido (`packages/shared/src/models.ts`); a imagem só decide a família.

**Não apague a `v1`** (turbo 2B + LM 1.7B): voltar ao motor anterior é apontar o endpoint de volta
para ela, sem rebuild.

> A base está fixada por **digest**, não por tag, em `apps/gpu-worker/Dockerfile`. Isso é
> deliberado: uma tag móvel trocaria o modelo em produção sem ninguém medir de novo o ritmo e o
> custo. Se for atualizar, meça antes.

## 2. Criar os dois endpoints

No console: **runpod.io → Serverless → New Endpoint**, uma vez para cada imagem. A configuração é
a mesma; só muda a imagem. Sem o endpoint SFT, a v2.0 e a v2.5 falham e o crédito é estornado
(não caem no Lyria).

| Campo | O que colocar | Por quê |
|---|---|---|
| Container Image | `…:v2-turbo` e `…:v2-sft` | uma imagem por endpoint |
| GPU | **24 GB** (L4, A5000 ou 3090) | com offload de encoder e VAE, pico medido de 16–18,6 GB nas duas famílias, e 2 faixas de 6 min passaram (XL-turbo na 3090, XL-SFT na L4). Sem offload, a L4 corta o lote do XL-SFT de 2 para 1 faixa |
| Active Workers | `0` | escala a zero: você paga só o que gerar |
| Max Workers | `1` para começar | um worker já atende a fila inicial; subir depois é um clique |
| Idle Timeout | `5` s | tempo que o worker fica vivo esperando o próximo job |
| FlashBoot | **ligado** | é o que faz diferença de verdade aqui — ver abaixo |
| Execution Timeout | `600` s (padrão) | a mais lenta, v2.5 com 2 faixas de 6 min, levou 325 s na L4 |
| Container Disk | `50 GB` | os pesos (~30 GB) e o áudio temporário |

**Sobre o FlashBoot:** o handler carrega os modelos na *importação do módulo*, não no primeiro
job. Isso é de propósito — é o que permite à RunPod congelar um worker já carregado. Com o
FlashBoot desligado, todo cold start paga de novo os ~56 s de carga dos modelos.

Não é preciso configurar variáveis de ambiente: os defaults do Dockerfile já estão certos para
uma GPU de 24 GB, inclusive `ACESTEP_OFFLOAD_TO_CPU=true`: sem ele, 2 faixas de 6 min são recusadas pela
checagem prévia de VRAM do ACE-Step. Ele só move encoder e VAE; o DiT e o LM ficam na GPU.

Botões que **podem** ser mexidos no endpoint, sem rebuild (o worker precisa reiniciar):

| Variável | Padrão | Para quê |
|---|---|---|
| `ACESTEP_SFT_STEPS` | `50` | passos do SFT quando o pedido não diz (pedidos do produto sempre dizem: 32 na v2.0, 50 na v2.5) |
| `ACESTEP_COT_CAPTION` | `true` | reescrita do caption quando o pedido não diz (pedidos do produto sempre dizem) |
| `ACESTEP_TRIM_TAIL` / `ACESTEP_FADE_OUT_S` | `true` / `1.5` | corte do silêncio final e fade no fim da faixa |
| `ACESTEP_LM_MODEL_PATH` | `acestep-5Hz-lm-1.7B` | o LM 4B não está na imagem: não melhorou nada na escuta e exige GPU de 48 GB |

## 2b. Endpoint de capas (FLUX.2 [klein] 4B)

As capas saem de um **terceiro endpoint**, com o `apps/image-worker`: FLUX.2 [klein] 4B
(Black Forest Labs, **Apache 2.0**, uso comercial liberado). O repositório não é "gated":
a imagem baixa os pesos **sem token do Hugging Face**, como a do ACE-Step.

```bash
docker build -t lucsfernandes/sonora-image-worker:v1 apps/image-worker
docker push lucsfernandes/sonora-image-worker:v1
```

| Campo | O que colocar | Por quê |
|---|---|---|
| Container Image | `…/sonora-image-worker:v1` | ~16 GB de pesos dentro da imagem |
| GPU | **24 GB** (L4, A5000, 3090) | o klein cabe inteiro em bf16, sem quantização |
| Active Workers / Idle / FlashBoot | `0` / `5` s / ligado | igual aos de música |
| Execution Timeout | `300` s | uma capa leva ~4 s; o teto cobre o cold start |
| Container Disk | `30 GB` | os pesos e a folga |

Secret no GitHub: `RUNPOD_ENDPOINT_ID_IMAGE`. Sem ele, as capas saem do OpenRouter como antes.
Medido na L4: 11 s de carga, **4,2 s por capa**, pico de 20,3 GB (`docs/BENCHMARK-CAPAS.md`). O
título e os versos **não** vão ao FLUX (ele os escreveria na capa): a letra vira uma cena pelo
modelo de texto (`OPENROUTER_TEXT_MODEL`, no ConfigMap do worker).
**Com** ele, o worker tenta o FLUX primeiro e cai no OpenRouter só se o FLUX falhar ou passar de
150 s (`apps/worker/src/generation/flux-cover.ts`).

## 3. Onde está o Endpoint ID

Depois de criar, a RunPod mostra o endpoint. O ID aparece em três lugares:

- No **card do endpoint**, embaixo do nome.
- Na **URL do console**: `runpod.io/console/serverless/user/endpoint/`**`abc123xyz`**.
- Na **URL da API** que a própria página mostra:
  `https://api.runpod.ai/v2/`**`abc123xyz`**`/run`.

É uma sequência curta de letras e números, algo como `k9v2mq7x1abcde`. Esse é o valor de
`RUNPOD_ENDPOINT_ID`.

A **API Key** é outra coisa, e fica em **Settings → API Keys → + API Key**. Ela começa com
`rpa_`. Guarde na hora: a RunPod não mostra de novo depois que você fecha o diálogo.

## 4. Conferir antes de apontar a produção

```bash
curl -s https://api.runpod.ai/v2/SEU_ENDPOINT_ID/health \
  -H "Authorization: Bearer SEU_RUNPOD_API_KEY"
```

Resposta esperada, com `workers` e `jobs` zerados num endpoint novo:

```json
{"jobs":{"completed":0,"failed":0,"inProgress":0,"inQueue":0},"workers":{"idle":0,"ready":0}}
```

Se vier `401`, a API Key está errada. Se vier `404`, o Endpoint ID está errado.

Para um teste de verdade, `scripts/runpod-bench.mjs` dispara uma geração e mede o tempo. Ele
espera `RUNPOD_API_KEY` e `RUNPOD_ENDPOINT_ID` no ambiente.

## 5. Ligar em produção

1. GitHub → Settings → Secrets → Actions: `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` (turbo) e
   `RUNPOD_ENDPOINT_ID_SFT` (SFT). O deploy do worker leva os três para o secret do pod.
2. `k8s/worker/configmap.yaml`: `MUSIC_PROVIDER: "acestep"`.
3. `packages/shared/src/plans.ts`: `ENGINE_MAX_DURATION_SECONDS = 480`.
4. Deploy do worker e da API (a API lê o mesmo teto para validar o que o plano permite).

O roteador (`apps/worker/src/providers/music-router.ts`) já escolhe o motor pela duração pedida:
acima do que o Lyria aguenta, o pedido vai para o ACE-Step. Não é preciso mexer nele.

---

## O primeiro cold start é lento, e isso é esperado

Com `Active Workers = 0`, o primeiro pedido depois de um período parado sobe um worker do zero:
puxar a imagem, carregar o ACE-Step e o LM. São alguns minutos. Do segundo pedido em diante,
com o FlashBoot, cai para segundos.

Com o XL-turbo isso pesa mais que no turbo de 2B: a carga medida foi de 54–79 s na 3090 (o DiT
de 4B está em fp32 em disco e vira bf16 na carga). O provider espera até 5 min na fila antes de
cair para o Lyria (`queueTimeoutMs`), justamente para um cold start não virar uma música do motor
de reserva — que é ~10x mais cara e de outra qualidade. Se a taxa de fallback subir, o remédio é
`Active Workers = 1`.

Se isso for inaceitável para o produto, a saída é `Active Workers = 1` — mas aí a GPU fica
ligada o tempo todo e o custo deixa de ser por uso. É uma decisão de negócio, não técnica.

## Quanto custa

A RunPod cobra por segundo de GPU. Os números abaixo são do **turbo + LM 1.7B na L4** (US$
0,0004/s no serverless — confira o preço atual no console, ele muda): uma música de 4 minutos
levou cerca de 90 s de GPU, algo em torno de US$ 0,04 por faixa.

**XL-turbo + LM 1.7B, medido na RTX 3090** (classe de 24 GB, US$ 0,69/h no serverless), com 2
faixas por pedido: 2 min **US$ 0,004**, 4 min US$ 0,007, 5 min US$ 0,009, 6 min **US$ 0,012**.
Um pedido de música nova entrega duas faixas pelos mesmos 10 créditos. Detalhes, a escuta e as
configurações descartadas em `docs/BENCHMARK-QUALIDADE.md`.
