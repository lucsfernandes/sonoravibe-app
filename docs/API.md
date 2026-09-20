# Sonora — API, URLs e hospedagem

Este documento responde três coisas: **onde cada aplicação roda**, **qual URL ela tem** e
**como chamar cada rota**. A coleção Postman equivalente está em [`docs/postman/`](postman/)
e é gerada por `node scripts/build-postman.mjs`.

> **Estado atual (honesto):** 11 das 45 rotas existem e respondem hoje — saúde, autenticação
> completa, geração de música e o progresso ao vivo. O restante está marcado como *planejado*:
> é o contrato do que está sendo construído, não rota quebrada.
>
> O que já funciona ponta a ponta: cadastro → créditos concedidos → `POST /songs/generate` →
> fila → worker → master no R2 → `complete` chegando por SSE, com os créditos confirmados.

---

## 1. Onde cada aplicação fica hospedada

| Aplicação | O que é | Onde roda | Por quê |
|---|---|---|---|
| `apps/web` | Next.js (interface PT-BR/EN) | **k3s + Traefik** no VPS Hostinger | Mesmo método de deploy das suas outras aplicações; SSR precisa de processo, não de função efêmera |
| `apps/api` | NestJS (REST + SSE) | **k3s + Traefik** no VPS Hostinger | Mantém SSE aberto por minutos e fala com Postgres/Redis na rede interna do cluster |
| `apps/worker` | Consumidor BullMQ (FFmpeg, Demucs, orquestração) | **k3s** no VPS Hostinger — sem ingress, só interno | Processo longo, consome fila, escala por HPA conforme o tamanho da fila |
| `apps/gpu-worker` | Handler Python com ACE-Step 1.5 | **RunPod Serverless** (L4 / A5000 / 3090) | Precisa de GPU e escala a zero; o VPS não tem GPU |
| PostgreSQL 16 | Banco | **k3s** — StatefulSet + PVC 20Gi | Dado seu, na sua máquina; backup diário por CronJob |
| Redis 7 | Filas BullMQ + pub/sub do SSE | **k3s** — StatefulSet + PVC 5Gi | Mesma rede do worker e da API |
| Áudio, capas, stems | Arquivos | **Cloudflare R2** | Egress gratuito — download de WAV/FLAC não vira conta de banda |
| Imagens Docker | Registry | **GHCR**, build por GitHub Actions | Já integrado ao repositório |
| Lyria 3 (reserva) | Motor de fallback | **OpenRouter** (API externa) | Só é acionado quando o ACE-Step falha de forma recuperável |

**Nada é hospedado na Vercel.** Se existe um projeto "worker" na sua conta Vercel, ele foi criado
pela integração Vercel↔GitHub ao importar o repositório novo: no primeiro commit o único pacote de
aplicação presente era `apps/worker/package.json`, e a Vercel o detectou como projeto. Esse worker é
um consumidor de filas — exige processo contínuo e conexão persistente com Redis, coisas que a Vercel
não oferece. Desconecte em **Vercel → projeto → Settings → Git → Disconnect** (ou apague o projeto).
Não há `vercel.json`, `.vercel/` nem qualquer referência a Vercel no repositório.

### Fluxo de deploy

```
git push → GitHub Actions
             ├── build web, api, worker             → GHCR → kubectl apply (k3s / Hostinger)
             └── build gpu-worker (pesos na imagem) → GHCR → endpoint RunPod Serverless
```

---

## 2. URLs

| Ambiente | Frontend | API | CDN de áudio |
|---|---|---|---|
| Desenvolvimento | `http://localhost:3000` | `http://localhost:3001` | MinIO em `http://localhost:9000` |
| Produção (planejado) | `https://sonora.app` | `https://api.sonora.app` | `https://cdn.sonora.app` |

O frontend ainda não foi criado (`apps/web` não existe). A porta 3000 já está reservada em `.env`
(`WEB_PORT`) e é a origem liberada no CORS da API (`CORS_ORIGINS`).

Serviços internos do cluster, sem URL pública: `worker`, `postgres`, `redis`. O `gpu-worker` também
não tem URL própria — é chamado pelo endpoint da RunPod
(`https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}/run`), com a chave em secret.

---

## 3. Rotas

Base local `http://localhost:3001` · Base produção `https://api.sonora.app`

Autenticação por cookie de sessão do Better Auth. Nos exemplos, `-c cookies.txt` grava o cookie no
login e `-b cookies.txt` o reaproveita.

### 3.1 Saúde — **implementado**

```bash
curl -i http://localhost:3001/health
```

```json
{
  "status": "ok",
  "checks": { "database": { "ok": true, "latencyMs": 3 }, "redis": { "ok": true, "latencyMs": 1 } },
  "uptimeSeconds": 42
}
```

Responde **503** com `"status": "degraded"` quando Postgres ou Redis estão fora — é o que o readiness
probe do k3s usa para tirar a réplica do balanceador.

---

### 3.2 Autenticação — **implementado**

```bash
# Cadastro
curl -X POST http://localhost:3001/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"name":"Lucas Fernandes","email":"lucas@exemplo.com","password":"senha-forte-aqui"}'

# Login
curl -X POST http://localhost:3001/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"email":"lucas@exemplo.com","password":"senha-forte-aqui"}'

# Sessão atual
curl http://localhost:3001/api/auth/get-session -b cookies.txt

# Sair
curl -X POST http://localhost:3001/api/auth/sign-out -b cookies.txt
```

O cadastro cria, na mesma transação: usuário, perfil público (handle derivado do e-mail),
workspace padrão e carteira de créditos — e, logo depois, concede a primeira cota diária do
plano Free (30 créditos), para a conta nova não nascer sem poder gerar nada.

As tabelas `user`, `session`, `account` e `verification` são do Better Auth, criadas pelas
migrations dele. A entidade `User` do TypeORM é `synchronize: false` justamente para as duas
ferramentas não disputarem o mesmo schema.

---

### 3.3 Geração de música — **implementado**

**Aba Simple** — só a descrição:

```bash
curl -X POST http://localhost:3001/songs/generate \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{
    "mode": "simple",
    "prompt": "pop rock brasileiro, violão e bateria ao vivo, clima de estrada",
    "instrumental": false
  }'
```

**Aba Advanced** — letra e controles completos:

```bash
curl -X POST http://localhost:3001/songs/generate \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{
    "mode": "advanced",
    "title": "Estrada até o mar",
    "lyrics": "[Verse]\nAcordei com o sol batendo na janela\n\n[Chorus]\nVou seguir a estrada até o mar",
    "instrumental": false,
    "controls": {
      "styles": "pop rock brasileiro, violão, bateria ao vivo",
      "excludeStyles": "distorção, autotune",
      "vocalGender": "male",
      "bpm": 104,
      "key": "G",
      "weirdness": 50,
      "styleInfluence": 50,
      "variety": "high"
    }
  }'
```

Omitir `durationSeconds` deixa a duração automática (derivada do tamanho da letra) — foi o que soou
mais natural nos testes. Quando informado, o limite vem do plano: Free 120s, Pro 240s, Premier 480s.
`excludeStyles` com termos vocais vira instrumental nativo no ACE-Step, não uma instrução em texto.

**Aba Sounds** — efeitos e loops curtos:

```bash
curl -X POST http://localhost:3001/songs/generate \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"mode":"sounds","prompt":"stab de synth analógico quente","soundType":"one-shot","bpm":120,"key":"Cm"}'
```

Resposta das três abas: `202` com `{ songId, generationId, creditsCharged, status: "queued" }`.
`402` quando falta crédito, `403` quando a duração ou o Max Mode excedem o plano, `400` com a
lista de campos inválidos, `401` sem sessão.

Os créditos são reservados **antes** de o job entrar na fila. É o que impede alguém com saldo
para uma música disparar dez de uma vez: a fila aceitaria todas e a cobrança só apareceria no
fim. Se a reserva falhar, a geração fica gravada como `failed` em vez de sumir — o usuário vê
no histórico por que não rodou.

**Progresso ao vivo (SSE):**

```bash
curl -N http://localhost:3001/generations/stream -b cookies.txt
```

```
event: progress
id: 1
data: {"generationId":"...","songId":"...","status":"compiling_prompt","progress":15}

event: progress
id: 2
data: {"generationId":"...","songId":"...","status":"generating_audio","progress":60}

event: progress
id: 4
data: {"generationId":"...","songId":"...","status":"complete","progress":100,
       "song":{"id":"...","title":"...","durationMs":30000,"audioUrl":"<URL assinada do R2>","coverUrl":null}}

event: ping
id: 5
data: {"at":"2026-09-19T23:58:18.467Z"}
```

Uma conexão só cobre todas as gerações do usuário. O `ping` a cada 25 s não é enfeite: Traefik e
proxies fecham conexão ociosa, e sem tráfego o navegador só descobriria a queda na geração
seguinte. Os eventos são filtrados por usuário no servidor — testado com duas sessões abertas ao
mesmo tempo.

**Status pontual e cancelamento:**

```bash
curl http://localhost:3001/generations/$GENERATION_ID -b cookies.txt

# Cancela o job na fila e estorna os créditos reservados
curl -X POST http://localhost:3001/generations/$GENERATION_ID/cancel -b cookies.txt
```

**Apoio de escrita** — *planejado*. Letra custa 1 crédito, sugestão de estilo é grátis:

```bash
curl -X POST http://localhost:3001/lyrics/generate \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"brief":"uma viagem de carro até o litoral, saudade e recomeço","language":"pt-BR"}'

curl -X POST http://localhost:3001/styles/suggest \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"seed":"synthwave melancólico"}'
```

---

### 3.4 Biblioteca de músicas — *planejado*

```bash
# Listar (paginação por cursor)
curl "http://localhost:3001/songs?workspaceId=$WORKSPACE_ID&limit=20&filter=all" -b cookies.txt

# Detalhe
curl http://localhost:3001/songs/$SONG_ID -b cookies.txt

# Renomear, mover de workspace, permissões
curl -X PATCH http://localhost:3001/songs/$SONG_ID \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"title":"Novo título","allowRemixes":true,"allowComments":true}'

# Lixeira: exclusão lógica; o arquivo sai do R2 depois de 30 dias
curl -X DELETE http://localhost:3001/songs/$SONG_ID -b cookies.txt

# Publicar no Explore
curl -X POST http://localhost:3001/songs/$SONG_ID/publish \
  -H 'Content-Type: application/json' -b cookies.txt -d '{"isPublic":true}'
```

**Download de um formato** — responde `302` para uma URL assinada do R2:

```bash
curl -L -o musica.mp3 "http://localhost:3001/songs/$SONG_ID/download?format=mp3" -b cookies.txt
```

Formatos: `mp3`, `wav`, `flac`, `opus`, `m4a`. O que ainda não foi transcodificado é gerado sob
demanda e fica 7 dias em cache. Plano Free baixa só MP3.

**Download de várias de uma vez** (planos pagos) — ZIP montado em streaming:

```bash
curl -X POST http://localhost:3001/songs/download-batch \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"songIds":["id-1","id-2","id-3"],"format":"wav"}' \
  -o sonora.zip
```

---

### 3.5 Edição — *planejado*

```bash
# Estender: consome crédito, é uma nova chamada ao motor
curl -X POST http://localhost:3001/songs/$SONG_ID/extend \
  -H 'Content-Type: application/json' -b cookies.txt -d '{"addSeconds":60}'

# Remix em outro estilo
curl -X POST http://localhost:3001/songs/$SONG_ID/remix \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"styles":"versão acústica, violão e voz"}'

# Substituir um trecho
curl -X POST http://localhost:3001/songs/$SONG_ID/replace-section \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"startMs":30000,"endMs":45000,"styles":"solo de guitarra"}'

# Edições sem IA: crop, trim, fade-in, fade-out, speed, reverse, normalize. Não custam crédito.
curl -X POST http://localhost:3001/songs/$SONG_ID/edit \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"operation":"crop","startMs":5000,"endMs":95000}'

# Separar stems (Demucs; sem crédito, mas só para planos pagos)
curl -X POST http://localhost:3001/songs/$SONG_ID/stems \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"kinds":["vocals","drums","bass","other"]}'

# Gerar capa
curl -X POST http://localhost:3001/songs/$SONG_ID/cover-art \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"prompt":"estrada ao entardecer, estética retrô"}'
```

---

### 3.6 Workspaces, playlists e estilos — *planejado*

```bash
curl http://localhost:3001/workspaces -b cookies.txt
curl -X POST http://localhost:3001/workspaces \
  -H 'Content-Type: application/json' -b cookies.txt -d '{"name":"Nocturne.sh"}'

curl http://localhost:3001/playlists -b cookies.txt
curl -X POST http://localhost:3001/playlists \
  -H 'Content-Type: application/json' -b cookies.txt -d '{"name":"Madrugada","isPublic":false}'

curl -X POST http://localhost:3001/playlists/$PLAYLIST_ID/songs \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d "{\"songId\":\"$SONG_ID\"}"

# Presets de estilo salvos
curl http://localhost:3001/styles -b cookies.txt
```

---

### 3.7 Social — *planejado*

```bash
# Públicos, sem sessão
curl "http://localhost:3001/explore?tab=trending"
curl http://localhost:3001/users/lucsfernandes
curl http://localhost:3001/songs/$SONG_ID/comments

# Com sessão
curl -X POST http://localhost:3001/songs/$SONG_ID/like -b cookies.txt
curl -X POST http://localhost:3001/songs/$SONG_ID/comments \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"body":"Muito boa!","timestampMs":42000}'
curl -X POST http://localhost:3001/users/lucsfernandes/follow -b cookies.txt

# Registro de reprodução: alimenta o ranking do Explore, deduplicado por janela de 30s
curl -X POST http://localhost:3001/songs/$SONG_ID/play \
  -H 'Content-Type: application/json' -d '{"listenedMs":45000}'
```

---

### 3.8 Créditos e cobrança — *planejado*

```bash
# Saldo do plano, saldo avulso, reservado e extrato do ledger
curl http://localhost:3001/credits -b cookies.txt

# Catálogo de planos e pacotes (público)
curl http://localhost:3001/plans

# Assinar: Free, Pro R$ 39, Premier R$ 99
curl -X POST http://localhost:3001/billing/subscribe \
  -H 'Content-Type: application/json' -b cookies.txt -d '{"planCode":"pro","method":"pix"}'

# Comprar pacote avulso (validade de 12 meses)
curl -X POST http://localhost:3001/billing/packs/pack_1500/purchase \
  -H 'Content-Type: application/json' -b cookies.txt -d '{"method":"pix"}'
```

**Webhook do Asaas** — não é você que chama, é o Asaas:

```bash
curl -X POST http://localhost:3001/webhooks/asaas \
  -H 'Content-Type: application/json' \
  -H "asaas-access-token: $ASAAS_WEBHOOK_TOKEN" \
  -d '{"event":"PAYMENT_CONFIRMED","payment":{"id":"pay_000001","status":"CONFIRMED"}}'
```

Idempotente pelo `provider_ref`: o Asaas reenvia o evento enquanto não receber `200`, e a concessão
de créditos não pode acontecer duas vezes.

Custo em créditos: música 10 · clipe 5 · estender/remix 10 · substituir trecho 10 · capa 2 ·
letra 1 · stems, transcode e edição sem IA 0.

---

## 4. Postman

```
docs/postman/
├── sonora.postman_collection.json        45 rotas em 8 pastas
├── sonora-local.postman_environment.json
└── sonora-producao.postman_environment.json
```

Importe os três arquivos (**Import → File**), escolha o ambiente no canto superior direito e rode
**Autenticação → Login por e-mail** primeiro: o Postman guarda o cookie de sessão e as demais
chamadas passam a ir autenticadas. Rotas ainda não implementadas têm `(planejado)` no nome e o
status descrito na aba *Description*.

Variáveis do ambiente: `apiUrl`, `webUrl`, `songId`, `generationId`, `workspaceId`, `playlistId`,
`handle`, `asaasWebhookToken`.

Os arquivos são **gerados**, não editados à mão. Para mudar uma rota, edite a lista em
`scripts/build-postman.mjs` e rode:

```bash
node scripts/build-postman.mjs
```

Assim a documentação não se descola do código conforme as rotas saem do "planejado".
