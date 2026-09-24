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

1. Coloque `RUNPOD_API_KEY` e `RUNPOD_ENDPOINT_ID` nos secrets do GitHub.
2. Mude `MUSIC_PROVIDER` para `acestep` no ConfigMap do worker.
3. Suba `ENGINE_MAX_DURATION_SECONDS` para `480` — e os limites por plano voltam a valer
   sozinhos, sem mais nenhuma mudança.

---

## 1. Publicar a imagem

A RunPod puxa a imagem de um registry; ela não constrói do seu repositório.

```bash
docker build -t lucsfernandes/sonora-gpu-worker:v2 apps/gpu-worker
docker push lucsfernandes/sonora-gpu-worker:v2
```

A imagem é grande: ~30 GB de pesos (DiT XL-turbo ~20 GB em fp32 e o modelo principal ~10 GB),
então o build pede ~70 GB livres em disco e o primeiro push demora.
Um runner padrão do GitHub Actions não comporta: construa de uma máquina com disco.

Publique como `v2` e **não apague a `v1`** (turbo 2B + LM 1.7B): voltar ao motor anterior é apontar
o endpoint de volta para ela, sem rebuild.

> A base está fixada por **digest**, não por tag, em `apps/gpu-worker/Dockerfile`. Isso é
> deliberado: uma tag móvel trocaria o modelo em produção sem ninguém medir de novo o ritmo e o
> custo. Se for atualizar, meça antes.

## 2. Criar o endpoint

No console: **runpod.io → Serverless → New Endpoint**.

| Campo | O que colocar | Por quê |
|---|---|---|
| Container Image | `lucsfernandes/sonora-gpu-worker:v2` | a imagem do passo 1 |
| GPU | **24 GB** (L4, A5000 ou 3090) | XL-turbo + LM 1.7B com offload de encoder e VAE: pico medido de 16,7–18,6 GB, e 2 faixas de 6 min passaram numa RTX 3090. A L4 é mais lenta que a 3090 (até ~2× no tempo, pela medição antiga) |
| Active Workers | `0` | escala a zero: você paga só o que gerar |
| Max Workers | `1` para começar | um worker já atende a fila inicial; subir depois é um clique |
| Idle Timeout | `5` s | tempo que o worker fica vivo esperando o próximo job |
| FlashBoot | **ligado** | é o que faz diferença de verdade aqui — ver abaixo |
| Execution Timeout | `600` s (padrão) | 2 faixas de 6 min levaram 59,5 s de geração na 3090; mesmo numa L4 sobra folga |
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
| `ACESTEP_SFT_STEPS` | `50` | só vale com `ACESTEP_CONFIG_PATH=acestep-v15-xl-sft`, que não está na imagem e soou pior na escuta |
| `ACESTEP_COT_CAPTION` | `true` | o LM reescreve o caption e o DiT recebe a versão dele. A configuração escolhida foi escutada com a reescrita ligada; desligar só foi testado com o XL-SFT. Escute antes de mudar |
| `ACESTEP_LM_MODEL_PATH` | `acestep-5Hz-lm-1.7B` | o LM 4B não está na imagem: não melhorou nada na escuta e exige GPU de 48 GB |
| `ACESTEP_CONFIG_PATH` | `acestep-v15-xl-turbo` | `acestep-v15-turbo` volta ao turbo de 2B (o antigo, com ruído); o worker troca sozinho o perfil de difusão |

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

1. GitHub → Settings → Secrets → Actions: `RUNPOD_API_KEY` e `RUNPOD_ENDPOINT_ID`.
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
