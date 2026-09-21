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
planos anunciam: sem esse teto, Pro e Premier venderiam 4 e 8 minutos que o motor não entrega.

O **ACE-Step 1.5** chega aos 480 s. Ele roda na RunPod porque precisa de GPU e escala a zero —
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
docker build -t lucsfernandes/sonora-gpu-worker:v1 apps/gpu-worker
docker push lucsfernandes/sonora-gpu-worker:v1
```

A imagem é grande (o ACE-Step e os pesos vêm na base). O primeiro push demora.

> A base está fixada por **digest**, não por tag, em `apps/gpu-worker/Dockerfile`. Isso é
> deliberado: uma tag móvel trocaria o modelo em produção sem ninguém medir de novo o ritmo e o
> custo. Se for atualizar, meça antes.

## 2. Criar o endpoint

No console: **runpod.io → Serverless → New Endpoint**.

| Campo | O que colocar | Por quê |
|---|---|---|
| Container Image | `lucsfernandes/sonora-gpu-worker:v1` | a imagem do passo 1 |
| GPU | **L4 24 GB** (ou A5000 / 3090) | o benchmark em `docs/ARQUITETURA.md` foi feito na L4; abaixo de 24 GB o LM não cabe junto com o DiT |
| Active Workers | `0` | escala a zero: você paga só o que gerar |
| Max Workers | `1` para começar | um worker já atende a fila inicial; subir depois é um clique |
| Idle Timeout | `5` s | tempo que o worker fica vivo esperando o próximo job |
| FlashBoot | **ligado** | é o que faz diferença de verdade aqui — ver abaixo |
| Container Disk | `20 GB` | os pesos e o áudio temporário |

**Sobre o FlashBoot:** o handler carrega os modelos na *importação do módulo*, não no primeiro
job. Isso é de propósito — é o que permite à RunPod congelar um worker já carregado. Com o
FlashBoot desligado, todo cold start paga de novo os ~56 s de carga dos modelos.

Não é preciso configurar variáveis de ambiente: os defaults do Dockerfile já estão certos para
uma GPU de 24 GB. As `ACESTEP_*_OFFLOAD_TO_CPU` existem só para rodar em 8 GB no teste local, e
ligá-las em produção deixaria a geração muito mais lenta.

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

Se isso for inaceitável para o produto, a saída é `Active Workers = 1` — mas aí a GPU fica
ligada o tempo todo e o custo deixa de ser por uso. É uma decisão de negócio, não técnica.

## Quanto custa

A RunPod cobra por segundo de GPU. A L4 fica na casa de US$ 0,0004/s no serverless (confira o
preço atual no console — ele muda). Uma música de 4 minutos levou cerca de 90 s de GPU no
benchmark, o que dá algo em torno de US$ 0,04 por faixa.

Compare com os 10 créditos que uma geração custa no produto antes de decidir o preço dos planos.
