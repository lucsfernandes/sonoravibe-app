# Sonora — Arquitetura

> Plataforma SaaS de geração de música com IA (com ou sem letra), inspirada no Suno.
> Documento de arquitetura e registro de decisões. Última atualização: 2026-09-19.

---

## 1. Visão geral

Sonora permite ao usuário descrever uma música em linguagem natural (ou colar a própria
letra), escolher estilo, excluir estilos indesejados, ajustar duração/vocal/criatividade,
e receber uma faixa pronta — com capa gerada, player, biblioteca, edição de áudio,
separação de stems, download em múltiplos formatos e publicação social.

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, next-intl (PT-BR/EN) |
| Backend | NestJS (REST + SSE), TypeORM, Better Auth |
| Worker | NestJS standalone + BullMQ consumers |
| Banco | PostgreSQL 16 (StatefulSet + PVC no k3s) |
| Fila/Cache | Redis 7 (StatefulSet + PVC) + BullMQ |
| Storage | Cloudflare R2 (S3-compatible, egress gratuito) |
| IA — música | **ACE-Step 1.5 na RunPod Serverless (principal)** · Lyria 3 via OpenRouter (reserva automática) |
| IA — texto e imagem | OpenRouter (LLM barato para letra e título, modelo de imagem para capa) |
| Áudio | FFmpeg (transcode/edição), Demucs (stems) |
| Pagamento | Asaas (PIX/boleto/cartão) atrás de interface `PaymentProvider` |
| Deploy | GitHub Actions → GHCR → `kubectl apply` → k3s + Traefik (VPS Hostinger) |

---

## 2. Decisões e justificativas

### 2.1 Motor de música: ACE-Step 1.5 (principal) + Lyria 3 (reserva)

> **Decisão (2026-09-19):** o ACE-Step 1.5 rodando na RunPod Serverless é o motor principal.
> O Lyria 3 via OpenRouter é a reserva automática — entra quando a RunPod falha, estoura o
> tempo limite ou fica sem capacidade.
>
> Motivos, todos medidos (detalhes nas subseções abaixo):
> - **~10x mais barato**: $0,007–0,009 por música contra $0,08
> - **Até 8 minutos** contra ~3 do Lyria
> - **Controles nativos** (duração, BPM, tom, idioma, seed) — o Lyria depende do Prompt Compiler
> - **Aceita áudio de entrada**: extend, cover e repaint de verdade
> - **WAV sem perdas nativo** (48 kHz) — o Lyria entrega MP3 192 kbps
> - **Pulso tão estável quanto o do Lyria**, desde que `thinking: true`
>
> **Teto real do motor: 8 minutos.** O `gpu_config` do ACE-Step limita a 480 s com o LM ligado.
> Os 10 min anunciados exigem o LM desligado — e sem ele volta o descompasso.
>
> **Teto do produto: 6 minutos** (`MAX_DURATION_SECONDS = 360` em `packages/shared`). É o
> máximo que qualquer plano oferece e que a API aceita; fica abaixo do que o motor aguenta de
> propósito, e o Premier é o plano que chega nele.
>
> O Prompt Compiler (§4.2) segue existindo para o caminho de reserva (Lyria).

As subseções a seguir registram as medições dos dois motores.

#### Lyria 3 via OpenRouter (reserva)

| Modelo | ID | Preço | Uso no produto |
|---|---|---|---|
| Lyria 3 Pro | `google/lyria-3-pro-preview` | **$0.08 / música** | Música completa (até ~3 min), MP3 192 kbps / 44.1 kHz estéreo, com vocais |
| Lyria 3 Clip | `google/lyria-3-clip-preview` | **$0.04 / clipe** | Aba *Sounds*: one-shots, loops, efeitos (30s) |

**Por que foi a primeira escolha:** era o custo mais baixo entre as APIs hospedadas com qualidade comparável ao Suno
(gateways de Suno cobram $0.05–0.11; ElevenLabs Music cobra $0.60–0.90 por faixa de 2–3 min),
e o crédito da OpenRouter já existe. A mesma chave atende música, LLM e imagem — um
fornecedor, uma fatura, uma integração.

**Limitação conhecida e como contornamos:** o Lyria **não expõe** parâmetros nativos de
`exclude_styles`, vocal gender, BPM slider, key ou seed — diferente do Suno. Resolvemos com
o **Prompt Compiler** (§4.2), uma camada que traduz os controles da UI em linguagem natural
antes da chamada. Isso é código nosso, não parâmetro de API: a fidelidade é alta mas não
determinística.

#### Comportamento real da API — medido, não suposto

Cada item abaixo foi confirmado com chamadas reais via `scripts/probe-lyria.mjs`.
A documentação pública não trazia nenhum deles.

| Achado | Impacto |
|---|---|
| Saída de áudio exige `stream: true` | Sem isso: `HTTP 400 "Audio output requires stream: true"`. O provider consome SSE. |
| Exige **saldo ≥ $0.50** disponível na chave | Sem isso: `HTTP 402`. Abaixo do piso, **toda** geração falha de uma vez. |
| Áudio chega em `choices[0].delta.audio.data` | Base64, normalmente num único chunk (clipe de 30s = ~957 KB num evento). |
| **`audio.format` é ignorado** | Pedimos WAV, recebemos **MP3 ~193 kbps / 44.1 kHz / estéreo**. Formato é detectado por magic bytes. |
| MP3 traz **manifesto C2PA assinado pelo Google** (~6 KB em ID3) | Credencial de proveniência de conteúdo gerado por IA. Transcodificar remove. |
| `delta.content` traz marcadores (`<instrumental>`) | Não é título; o título vem do LLM, não do modelo de música. |
| Latência: ~10 s para clipe de 30 s · custo exato: $0.04 | Confirma a estimativa. `usage.cost` vem no último evento do stream. |

**Consequência para os planos:** como o master é MP3 lossy, WAV e FLAC gerados a partir
dele são *lossless de um áudio lossy* — ocupam 5 a 12x mais espaço sem recuperar nada.
Medido: um clipe de 30s vira 0.68 MB em MP3, 4.99 MB em WAV e **5.32 MB em FLAC** — o FLAC
fica maior que o WAV porque não há redundância para comprimir num MP3 decodificado.
O Lyria Pro foi testado e entrega **a mesma qualidade** do Clip, então não existe tier
superior a vender. Formato deixou de ser diferencial de plano.

**Consequência legal:** o manifesto C2PA é a prova criptográfica de que o áudio é gerado
por IA. Transcodificar **remove essa credencial** (confirmado nos 4 formatos). Estratégia
adotada em duas camadas: o MP3 original é preservado intacto como download canônico, e
todo formato convertido recebe metadados de proveniência nossos declarando a origem e
apontando para o MP3 que carrega a credencial assinada.

#### ACE-Step 1.5 (principal) — medido em 2026-09-19

O Lyria tem teto de ~3 min (entregou 2:47) e nenhum modelo da OpenRouter passa disso.
Emendar trechos do Lyria não funciona: ele não aceita áudio de entrada, então cada trecho
nasce sem ouvir o anterior (muda tom, andamento e voz). O candidato é o **ACE-Step 1.5**
(licença MIT, 10 s a 10 min, português entre os idiomas de melhor suporte, servidor REST
próprio, aceita áudio de entrada para extend/cover/repaint).

Medições com a mesma música — 4min30, pop rock em português com letra, seed 42:

| Ambiente | Tempo | Memória | Observação |
|---|---|---|---|
| RTX 4060 8 GB (turbo 2B + LM 0.6B) | **86,8 s** | 6,5 GB VRAM (pico) | 47 s são offload CPU↔GPU por falta de VRAM; computação real ≈ 40 s |
| CPU i5-14600KF, 4 threads | **8 min 50 s** | **16,5 GB RAM** | LM 23 s · difusão 238 s · VAE 249 s |
| Cold start (carga dos modelos) | 220 s do disco · 38–144 s com cache | — | É o custo de acordar um worker serverless do zero |

Saída: MP3 128 kbps / 48 kHz por padrão, ou **WAV float32 48 kHz nativo** (`format: wav`) —
diferente do Lyria, aqui FLAC/WAV são lossless de verdade. **Não traz C2PA**: para essas
faixas, os metadados de `provenance.ts` são a única marcação de origem. Mesma seed produz
áudio diferente em GPU e CPU.

**Por que não CPU na VPS:** 16,5 GB de RAM só para o modelo (só o KVM 8 da Hostinger
comporta, dividindo com todo o cluster) e ~9 min por música num processador de desktop —
vCPUs EPYC compartilhadas tendem a ser mais lentas. Vazão de ~4–6 músicas/hora ocupando a
máquina inteira. Ollama não gera música; o equivalente para áudio é o audio.cpp (ggml,
roda ACE-Step 1.5 desde a v0.7), mas o teto em CPU continua sendo minutos por faixa.

**Por que não o `fetch` padrão:** o undici do Node desiste após 5 min sem cabeçalhos. Uma
geração em hardware lento passa disso. O provider usa timeout explícito.

**`thinking` é obrigatório — o servidor compatível com OpenRouter vem com ele DESLIGADO.**
Sem ele, o LM só produz metadados e a difusão gera sem esqueleto rítmico: na escuta, os
instrumentos soaram descompassados. Medido com `scripts/analyze-rhythm.py` (librosa), mesma
música e seed:

| Variante | Variação entre batidas | Batidas >10% fora |
|---|---|---|
| Lyria Pro (referência) | 2,25% | 0,9% |
| ACE-Step, `thinking: false` | 4,67% | 4,0% |
| ACE-Step, `thinking: true` | **1,90%** | **0,0%** |
| ACE-Step, `thinking: true` + duração automática | 2,14% | 0,0% |

Custo: +49 s na RTX 4060 (86,8 s → 135,7 s para 4min30). O `AceStepProvider` envia
`thinking: true` sempre.

**Benchmark na RunPod — GPU L4 24 GB (classe "24 GB" do serverless), turbo + LM 1.7B,
backend vllm, `thinking: true`, sem offload.** Rodado com `scripts/runpod-bench.mjs`
(imagem oficial `ghcr.io/ace-step/ace-step-1.5:latest`), custo do teste: $0,044.

| Medida | L4 (RunPod) | RTX 4060 (local) |
|---|---|---|
| Pull da imagem + início do container | 157 s | — |
| **Carga dos modelos (cold start do worker)** | **56 s** | 220 s |
| Música de 4min30 | **44,8 s** (6,0x tempo real) | 135,7 s |
| Música de ~3min20 (duração automática) | **33,8 s** | 68,7 s |
| Fases (4min30) | LM metadados 3 s · **LM códigos 24,5 s** · difusão 3 s · VAE ~14 s | — |
| Estabilidade do pulso | 1,78–2,41% / 0–0,2% fora | 1,90% / 0% |

O gargalo é o LM gerando os códigos semânticos (o `thinking`), não a difusão. Com vllm e LM
1.7B, a mesma seed produziu durações diferentes entre execuções (185 s e 198 s): regerar com
a mesma seed não garante reprodução.

**Custo projetado no serverless** (24 GB flex, $0,69/h = $0,000192/s):

| | Custo |
|---|---|
| Música de 4min30 | ~$0,0086 |
| Música de ~3min20 | ~$0,0065 |
| Cold start (56 s de carga, pesos já na imagem) | ~$0,011 por ocorrência |
| 1.000 músicas/mês (30% com cold start) | ~$11 |
| 10.000 músicas/mês (5% com cold start) | ~$80 |
| *Referência: Lyria Pro, até 3 min* | *$0,08/música · $80 por 1.000* |

**Duração com letra:** forçar a duração não afetou o ritmo, mas estica ou comprime a
estrutura — para a letra de teste o modelo escolheu 210 s e nós havíamos forçado 270 s. Para
música cantada, o padrão da UI é duração automática; se o usuário fixar uma duração, a UI
avisa quando ela destoa do tamanho da letra.

**Abstração:** todos os provedores implementam `MusicProvider`. Trocar ou somar motor
(MiniMax $0.035, Suno via gateway, ACE-Step self-hosted) é criar uma classe nova.

```ts
interface MusicProvider {
  readonly id: string;
  generate(req: MusicGenerationRequest): Promise<MusicGenerationResult>;
  extend?(req: ExtendRequest): Promise<MusicGenerationResult>;
  estimateCost(req: MusicGenerationRequest): number; // em créditos
}
```

`MockMusicProvider` gera áudio sintético via FFmpeg para desenvolver sem gastar crédito.

### 2.2 Postgres e Redis self-hosted no k3s

Escolhido em vez de Supabase/Neon: custo fixo, zero lock-in, coerente com a infra k3s já
existente. **Contrapartida obrigatória:** um `CronJob` diário de `pg_dump` → R2 com retenção
de 30 dias. Sem isso, um PVC corrompido leva junto usuários e cobranças.

### 2.3 Fila BullMQ + progresso por SSE

Geração leva de 30s a alguns minutos. BullMQ dá retry com backoff, prioridade por plano
(Premier fura fila), rate limit por usuário e dashboard de jobs. O progresso chega ao
browser por **Server-Sent Events** — unidirecional, mais simples que WebSocket e suficiente
para `queued → running → uploading → complete`.

### 2.4 Storage: R2 com transcodificação sob demanda

Guardamos **um master** por música. Faixas do ACE-Step (principal): master **FLAC 24-bit / 48 kHz**, sem perdas de verdade, e o MP3 320k é derivado dele. Faixas do Lyria (reserva): o master é o MP3 exatamente como o Lyria devolveu. Ele **é** o
download MP3 — nunca é reencodado, porque reencodar inflaria o arquivo, somaria perda de
geração e apagaria o manifesto C2PA. WAV/FLAC/Opus/M4A são transcodificados pelo worker
quando pedidos e ficam em cache no R2 por 7 dias (limpeza por CronJob). Um WAV de 3 min
pesa ~32 MB contra ~4 MB do master — pré-gerar tudo multiplicaria o storage por ~8.

**Download em lote:** endpoint que monta um ZIP em *streaming* (`archiver`), sem carregar
tudo em memória, transcodificando o que faltar antes de empacotar.

**O R2 não valida o `Content-Type` da URL assinada** (medido em 2026-09-19 contra o bucket
real: um PUT com tipo divergente voltou HTTP 200 e o objeto ficou gravado com o tipo
errado). Como o worker GPU roda fora do nosso cluster, quem finaliza a geração confere o
objeto com `statObject` antes de marcar a música como pronta — tamanho e tipo. Confiar na
assinatura serviria um arquivo com tipo inválido ao player.

### 2.5 Better Auth

Roda no nosso Postgres, sem custo por usuário. Entrega e-mail/senha, OAuth (Google),
sessões, verificação de e-mail e reset de senha prontos — o que com Passport+JWT seria
código manual. Emite sessão consumida tanto pelo Next quanto pelo NestJS.

### 2.6 Pagamento: Asaas atrás de `PaymentProvider`

Asaas tem API REST simples, assinatura recorrente nativa com PIX e boleto, e documentação
em português. A interface `PaymentProvider` permite somar Stripe depois para vender em dólar
sem tocar na lógica de créditos.

---

## 3. Monorepo

```
sonora/
├── apps/
│   ├── web/              Next.js 15 — app do usuário (PT-BR/EN)
│   ├── api/              NestJS — REST, SSE, auth, webhooks
│   └── worker/           NestJS standalone — consumers BullMQ
├── packages/
│   ├── shared/           tipos, DTOs, schemas Zod, catálogo de estilos, tabela de custos
│   ├── db/               entidades TypeORM + migrations
│   └── tsconfig/         configs base compartilhadas
├── infra/
│   ├── k8s/              manifests do k3s (base/ + overlays/)
│   └── docker/           Dockerfiles
├── sites/
│   ├── institucional/    site institucional (skill /site-institucional)
│   └── vendas/           página de vendas (skill /pagina-de-vendas)
└── docs/
```

Gerenciador: **pnpm workspaces + Turborepo**. ORM: **TypeORM 1.x** (entidades com decorators,
alinhado ao padrão NestJS).

### 3.1 Por que SWC, e não tsx/esbuild, na API e no worker

O `.swcrc` fica na **raiz** do monorepo de propósito. Dois motivos, os dois medidos:

1. **O esbuild não implementa `emitDecoratorMetadata`**, de que NestJS (injeção por tipo)
   e TypeORM (inferência de coluna) dependem.
2. **O `tsx` aplica o `tsconfig` só aos arquivos dentro da pasta dele.** Rodando a API a
   partir de `apps/api`, os arquivos de `packages/db` caíam no padrão do esbuild e os
   decorators viravam TC39: o TypeORM quebrava em `Reflect.getMetadata` com `TypeError`.
   O swc resolve o `.swcrc` subindo a partir de cada arquivo, então um único arquivo na
   raiz vale para todos os pacotes.

O `.swcrc` é JSON estrito: não aceita comentários nem chaves desconhecidas.

---

## 4. Fluxo de geração

### 4.1 Caminho feliz

```
POST /api/songs/generate
  │
  ├─ valida entrada (Zod)
  ├─ calcula custo em créditos
  ├─ DÉBITO RESERVADO no ledger (transação atômica)
  ├─ cria Song(status=QUEUED) + Generation(status=PENDING)
  └─ enfileira job no BullMQ ──────────────┐
                                           ▼
                              [worker: generation queue]
                                 1. Letra, se pedida (LLM via OpenRouter)
                                 2. Gera URL pré-assinada de upload no R2
                                 3. MusicRouter escolhe o provider:
                                      AceStepProvider → RunPod Serverless
                                        └─ worker GPU gera e sobe o master FLAC
                                           direto no R2 (resposta da RunPod é
                                           limitada a 10–30 MB)
                                      falha/timeout → LyriaProvider
                                        └─ Prompt Compiler + OpenRouter
                                 4. Registra o master (FLAC do ACE-Step ou
                                    MP3 do Lyria, este sem reencode)
                                 5. MP3 320k derivado do FLAC (só ACE-Step)
                                 6. Song(status=COMPLETE), já com a capa:
                                    ela é desenhada em paralelo desde o passo 2
                                    (modelo de imagem → R2), sem custar crédito
                                           │
                     SSE /api/generations/stream ──► browser atualiza em tempo real
```

**Falha em qualquer etapa:** `Generation(status=FAILED)` + **estorno automático** dos
créditos reservados no ledger, com motivo registrado.

### 4.2 Prompt Compiler

Traduz os controles da UI para o prompt em linguagem natural que o Lyria entende:

| Controle da UI | Como vira prompt |
|---|---|
| `styles: ["synthwave", "80s"]` | base do prompt de estilo |
| `excludeStyles: ["vocals", "rap"]` | `"strictly instrumental, no vocals, no rap"` |
| `vocalGender: female` | `"female lead vocal"` |
| `bpm: 62` | `"at 62 BPM, unhurried"` |
| `weirdness: 80%` | `"experimental, unconventional structure"` |
| `styleInfluence: 90%` | `"strictly adhere to the described style"` |
| `instrumental: true` | `"instrumental only, no lyrics"` |
| `duration` | mapeado para Lyria Pro (~3min) ou Clip (30s) |

Roda num LLM barato via OpenRouter, com *few-shot* e cache por hash dos parâmetros (mesma
combinação não paga duas vezes).

### 4.3 Filas

| Fila | Job | Custo |
|---|---|---|
| `generation` | música completa / clipe / extend / remix | crédito (chamada Lyria) |
| `transcode` | WAV, FLAC, OPUS, ZIP em lote | grátis (FFmpeg) |
| `edit` | crop, fade, speed, reverse, normalize | grátis (FFmpeg) |
| `stems` | separação Demucs | grátis, mas pesado — worker dedicado |
| `cover` | capa nova para uma música pronta (a primeira sai junto com a música, sem custo) | 2 créditos (modelo de imagem) |
| `maintenance` | backup, limpeza de cache, expiração de créditos | grátis |

---

## 5. Modelo de dados (resumo)

**Identidade** — `users`, `sessions`, `accounts`, `verifications` (Better Auth), `profiles`
(handle, bio, avatar, música fixada).

**Monetização** — `plans`, `subscriptions`, `credit_wallets`, `credit_transactions`
(ledger append-only: nunca atualizamos saldo direto, sempre lançamos movimento),
`credit_packs`, `invoices`, `payments`.

**Conteúdo** — `workspaces`, `songs`, `song_renditions` (formato/bitrate/chave no R2),
`generations`, `stems`, `styles` (biblioteca salva), `lyrics_drafts`, `personas`.

**Social** — `playlists`, `playlist_songs`, `likes`, `comments`, `follows`, `plays`.

`songs.parent_song_id` cobre remix, extend e cover — a linhagem de uma faixa é uma árvore.

### 5.1 Por que ledger e não coluna de saldo

`credit_transactions` é append-only (`+` compra/renovação, `−` consumo, `+` estorno).
O saldo é a soma. Isso dá auditoria completa, estorno confiável quando a geração falha, e
elimina condição de corrida entre duas gerações simultâneas (a reserva é uma transação
com `SELECT ... FOR UPDATE` na carteira).

---

## 6. Planos e créditos

| Plano | Preço | Créditos | Formatos | Extras |
|---|---|---|---|---|
| Free | R$ 0 | 30/dia | MP3 128k | uso pessoal, fila normal |
| Pro | R$ 39/mês | 5.000/mês | todos (MP3 original, WAV, FLAC, Opus, M4A) | uso comercial, stems |
| Premier | R$ 99/mês | 20.000/mês | todos (idem Pro) | fila prioritária, 6 gerações simultâneas, Max Mode |

**Pacotes avulsos** (PIX à vista) somam à carteira e são consumidos **depois** dos créditos
do plano, com validade de 12 meses. Créditos do plano expiram na renovação.

Custo em créditos por operação (1 crédito ≈ R$ 0,01 de custo interno):

| Operação | Créditos | Custo real — ACE-Step (principal) | Custo real — Lyria (reserva) |
|---|---|---|---|
| Música completa | 10 | ~$0,007–0,009 (medido) | $0,08 |
| Clipe / Sound | 5 | ~$0,002 (estimado) | $0,04 |
| Extend / Remix | 10 | ~$0,008 (estimado) | $0,08 |
| Capa nova (a primeira sai com a música, grátis) | 2 | ~$0,03–0,07 (Gemini Flash Image) | — |
| Letra (LLM) | 1 | ~$0,001 | — |
| Stems, edição FFmpeg, transcode | 0 | $0 | — |

Margem no Pro: 5.000 créditos = 500 músicas × ~$0,008 = **~$4 de custo máximo** contra
R$ 39 de receita — saudável mesmo com 100% da cota usada. O risco de margem migrou para o
caminho de reserva: cada música que cai no Lyria custa 10x mais, então um período longo em
reserva (RunPod fora do ar) volta a apertar a margem. Ver §8.

Limite de duração por plano: Free 2 min · Pro 4 min · Premier 6 min (Max Mode, o teto do produto).

---

## 7. Infraestrutura (k3s + Traefik)

```
Internet → Traefik Ingress (TLS via cert-manager, ClusterIssuer letsencrypt-prod)
   ├── sonoravibe.com / www   → sonora-web     (Next.js, 1 réplica, HPA 1–2)
   ├── api.sonoravibe.com     → sonora-api     (NestJS, 1 réplica, HPA 1–2)
   └── (sem ingress)          → sonora-worker  (filas; Recreate, sem HPA)
                              → sonora-redis   (StatefulSet + PVC 5Gi)

Fora do namespace:
   postgres (namespace `databases`, compartilhado com os outros projetos)

Fora do cluster:
   RunPod Serverless ── worker ACE-Step (L4/A5000/3090, escala a zero)
   Cloudflare R2 ────── áudio, capas e stems (egress gratuito)
```

Namespace `sonora`, com PSA `restricted`: todo pod roda como UID 1001 não-root,
com root FS somente leitura e `drop: [ALL]`.

CI/CD: `git push` na `main` → GitHub Actions → build → **Docker Hub** (tag = SHA
do commit) → `kubectl apply -k`. Um workflow por aplicação, com filtro de
caminho — mexer no CSS não pode reiniciar o worker no meio de uma geração.

Passo a passo, pré-requisitos e diagnóstico em [DEPLOY.md](DEPLOY.md).

### 7.1 Decisões de operação que vieram da prática

| Decisão | Por quê |
|---|---|
| Worker com `Recreate`, não rolling | Num rolling os dois pods consomem a mesma fila e o antigo pode pegar um job que o novo já iniciou. |
| Worker com grace period de 15 min | O desligamento espera os jobs ativos; cortar antes devolveria o job à fila e o usuário pagaria a música duas vezes. |
| Worker com probe `exec` sobre `/tmp/heartbeat` | Ele não escuta em porta nenhuma; probe HTTP falharia sempre e reiniciaria o pod em laço. |
| Worker sem HPA | Escalar por CPU subiria réplica justamente quando o FFmpeg ocupa a CPU, e a VPS não tem essa folga. |
| API com 512Mi de limite | Com 256Mi o pod morre por OOM na subida: 18 entidades do TypeORM, pool do Postgres, três filas e o pub/sub do SSE. |
| API com grace period de 60s | O SSE mantém conexão aberta por minutos; 30s cortaria o stream de quem acompanha uma geração. |
| Redis com `appendonly yes` | Fila perdida num restart é música paga e não entregue. |
| `allowBuilds` no pnpm-workspace.yaml | Sem aprovar o script do `@swc/core`, o binário nativo não é instalado: no terminal é um aviso, no build do Docker é erro fatal. |
| Sem a porta 5432 no egress público | O Postgres é o do cluster; abrir a 5432 para a internet seria caminho de saída de dados à toa. |

## 8. Riscos abertos

| Risco | Mitigação |
|---|---|
| **Saldo mínimo de $0.50 na OpenRouter para saída de áudio** — confirmado em teste real (HTTP 402). Abaixo disso *toda* geração falha, não só a que estouraria o saldo | Alerta de saldo baixo em $5, bloqueio preventivo da fila em $1 com mensagem clara ao usuário, e recarga automática configurada na conta. Sem isso, um saldo baixo derruba o produto inteiro de uma vez |
| **Dependência da RunPod** — indisponibilidade, fila cheia ou falta de GPU | Fallback automático para o Lyria com timeout de fila; alerta quando a taxa de fallback passar de 10%, porque cada música na reserva custa ~10x mais |
| **Cold start de 56 s** quando o worker está desligado | Pesos dentro da imagem e carga no init (aproveita o FlashBoot); com volume constante, manter 1 worker ativo; a UI mostra "preparando o estúdio" no progresso |
| `thinking` desligado por engano traz o descompasso de volta | O `AceStepProvider` envia `thinking: true` sempre; teste de regressão com `analyze-rhythm.py` numa faixa de referência a cada atualização do modelo |
| **O LM reescreve o caption** (`use_cot_caption`) e pode se afastar do estilo pedido — observado: pedimos "live drums" e a descrição gerada disse "drum machine"; também inventou um tema ("rainy day") ausente da letra | Nunca exibir o caption do LM como descrição da música. Testar `use_cot_caption: false` mantendo `thinking: true` e **medir o ritmo de novo** com `analyze-rhythm.py` antes de mudar — o ritmo corrigido foi medido com a reescrita ligada |
| Qualidade: só a variante turbo 2B + LM 1.7B foi testada | A variante XL (mais pesada, 24 GB sem offload) é a próxima alavanca de qualidade — testar antes do lançamento |
| Lyria 3 está em *preview* — API pode mudar ou sair do ar | Deixou de ser crítico: agora é reserva. A abstração `MusicProvider` permite trocar |
| Sem controle determinístico de estilo no Lyria (sem seed/BPM nativo) | Só afeta o caminho de reserva; Prompt Compiler + expectativa clara na UI |
| Demucs em CPU é lento (minutos por faixa) | Worker dedicado, fila separada, stems só para Pro+ |
| **Master é MP3 lossy** — FLAC/WAV não entregam qualidade superior | **Decidido.** Testado o Lyria Pro ($0.08): mesma qualidade do Clip (MP3 192 kbps / 44.1 kHz). Formato deixou de ser alavanca de plano — Pro e Premier baixam todos. Premier se diferencia por créditos, fila prioritária, concorrência e Max Mode. UI rotula WAV/FLAC como "convertido do master" |
| **Transcodificar remove o manifesto C2PA** do Google | **Decidido: preservar + reanexar.** MP3 original com C2PA intacto é o download canônico e nunca é reescrito. Formatos convertidos recebem metadados de proveniência (`packages/shared/src/provenance.ts`), validados em WAV, FLAC, Opus e M4A. Limite: metadado comum não é assinado — documenta a origem, não a prova |
| Direitos autorais / uso comercial do output | ACE-Step é MIT (uso comercial permitido, com disclosure de IA). Termos de uso explícitos; verificar licença do Lyria e os termos do C2PA do Google para as faixas geradas na reserva |
| Conteúdo abusivo publicado no Explore | Moderação por LLM na publicação + denúncia |
