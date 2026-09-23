# Deploy — GitHub Actions → Docker Hub → k3s (Hostinger)

`git push` na `main` dispara o deploy. Cada aplicação tem o próprio workflow, com
filtro de caminho: mexer só no frontend não redeploya a API nem o worker — e o
worker pode estar no meio de uma geração que o usuário pagou.

```
push na main
  ├── apps/api/**    ou packages/**  → deploy-api.yml    → sonora-api
  ├── apps/web/**                    → deploy-web.yml    → sonora-web
  └── apps/worker/** ou packages/**  → deploy-worker.yml → sonora-worker
```

Cada workflow: build da imagem → push no Docker Hub com a tag = SHA do commit →
cria/atualiza o Secret no cluster → `kubectl apply -k` → **espera o rollout**.

O `rollout status` no fim não é enfeite: como `maxUnavailable: 0` mantém o pod
antigo servindo, um deploy quebrado deixaria o site no ar e o job verde. A falha
passaria despercebida até alguém reparar que o código novo nunca entrou.

---

## 1. O que roda onde

| Componente | Imagem | Exposição |
|---|---|---|
| `sonora-web` | `<user>/sonora-web` | `sonoravibe.com` e `www.sonoravibe.com` |
| `sonora-api` | `<user>/sonora-api` | `api.sonoravibe.com` |
| `sonora-worker` | `<user>/sonora-worker` | nenhuma — puxa trabalho da fila |
| `sonora-redis` | `redis:7.4-alpine` | interna, só API e worker |
| PostgreSQL | já existe | namespace `databases`, compartilhado |
| `sonora-gpu-worker` | — | **RunPod Serverless**, fora do cluster |

Tudo no namespace `sonora`, com PSA `restricted`.

---

## 2. Antes do primeiro deploy

### 2.1 Banco de dados

O Postgres do namespace `databases` é compartilhado com seus outros projetos.

**Endereço interno** (verificado no cluster em 20/09/2026):

```
postgres-rw.databases.svc.cluster.local:5432
```

Existem dois Services apontando para o mesmo pod `postgres-0`:

| Service | Tipo | Quando usar |
|---|---|---|
| `postgres-rw` | ClusterIP `10.43.26.198` | **este** — é o endpoint de leitura e escrita |
| `postgres` | headless (`ClusterIP: None`) | resolve direto para o IP do pod; serve, mas é o Service de identidade do StatefulSet |

Os dois funcionam hoje, com uma réplica só. O `-rw` é o certo porque, no dia em que
existir uma réplica de leitura, ele continua apontando para o primário — o headless
passaria a devolver os dois.

**Não use o endereço externo** (`divinabella.arcobatrox.com.br:5432`, o do DBeaver): a
NetworkPolicy libera a porta 5432 apenas para dentro do namespace `databases`, e
deliberadamente não a abre para a internet. Pelo endereço público a conexão morre em
timeout — sem mensagem que explique por quê.

Crie o banco e o usuário do Sonora (uma vez só):

```sql
CREATE DATABASE sonora_vibe;
CREATE USER sonora_user_admin WITH PASSWORD '<a senha que você definiu>';
GRANT ALL PRIVILEGES ON DATABASE sonora_vibe TO sonora_user_admin;
\c sonora_vibe
GRANT ALL ON SCHEMA public TO sonora_user_admin;
```

O último `GRANT` é necessário no PostgreSQL 15+: desde essa versão o schema
`public` não é mais gravável por qualquer usuário, e sem ele a criação das
tabelas falha com `permission denied for schema public`.

### 2.2 Schema das tabelas — depois do primeiro deploy, não antes

`DB_SYNCHRONIZE` é `false` em produção: o `synchronize` do TypeORM apaga coluna
que sumiu do código, e aqui isso significaria perder música de usuário.

**A consequência é uma armadilha:** com ele desligado, nem as migrations do
Better Auth nem as tabelas do domínio nascem — mas a API sobe **verde**. O
`/health` só faz `SELECT 1` e um `ping` no Redis, e os dois passam num banco
vazio. Todas as rotas reais respondem 500 até o schema existir.

A criação usa a imagem da API, que só passa a existir depois do primeiro build.
Por isso este passo vem **depois** do Deploy API — veja a ordem na seção 3.

```bash
bash scripts/criar-schema.sh
```

O script descobre a imagem que está rodando, aplica `k8s/api/job-schema.yaml`,
acompanha os logs e confirma o resultado. Saída esperada:

```
Banco: postgresql://sonora_user_admin:***@postgres-rw.databases.svc.cluster.local:5432/sonora_vibe
Better Auth: criando user, session, account, verification
Domínio: entidades sincronizadas.

21 tabelas no schema public:
  account
  credit_transactions
  ...
Pronto.
```

Não é preciso conferir com `psql` depois: o próprio script lista as tabelas. E a
senha sai mascarada, porque essa saída vai para o log do cluster.

#### Por que um Job, e não `kubectl run`

Duas razões, as duas descobertas na prática:

- O namespace tem **PSA `restricted`**. Um `kubectl run` pelado é rejeitado
  antes de o pod existir: *"violates PodSecurity restricted:latest"*. O
  manifesto declara os quatro campos exigidos (`runAsNonRoot`,
  `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`,
  `seccompProfile`).
- Subir a **API inteira** com `DB_SYNCHRONIZE=true` deixa um processo escutando
  para sempre — como Job ele nunca completaria, e à mão exigiria apertar
  `Ctrl+C` sem saber se o schema já terminou. O `src/schema.ts` faz só o
  necessário e encerra (medido: 14 s num banco vazio, código de saída 0).

O Job sobrescreve três variáveis da configuração da API, cada uma com motivo:
`DB_SYNCHRONIZE=true` (é o que cria as tabelas), `NODE_ENV=development` (em
produção a validação recusa o synchronize — proteção que queremos manter no
Deployment) e `MUSIC_PROVIDER=mock` (criar tabela não precisa de motor de música).

### 2.3 GitHub Secrets

Repositório → Settings → Secrets and variables → Actions.

**Infraestrutura** (os três que a skill exige):

| Secret | O que é |
|---|---|
| `DOCKERHUB_USER` | usuário do Docker Hub |
| `DOCKERHUB_PASS` | token de acesso (não a senha da conta) |
| `KUBECONFIG` | kubeconfig do cluster, **em base64** |

**Aplicação:**

| Secret | Usado por | Observação |
|---|---|---|
| `DATABASE_URL` | api, worker | `postgresql://sonora_user_admin:<senha>@postgres-rw.databases.svc.cluster.local:5432/sonora_vibe` |
| `REDIS_URL` | api, worker | `redis://sonora-redis.sonora.svc.cluster.local:6379` |
| `BETTER_AUTH_SECRET` | api | `openssl rand -base64 32` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | api, worker | Cloudflare R2 |
| `OPENROUTER_API_KEY` | api, worker | letra, capa e o motor reserva Lyria |
| `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` | api, worker | **dispensáveis hoje** — só exigidos com `MUSIC_PROVIDER=acestep` (ver 2.5) |
| `ASAAS_API_KEY` | api | produção, não sandbox |
| `ASAAS_WEBHOOK_TOKEN` | api | **obrigatório**: sem ele, qualquer um chama o webhook e concede créditos a si mesmo |

Gerar o kubeconfig em base64:

```bash
# na VPS
sudo cat /etc/rancher/k3s/k3s.yaml | sed "s/127.0.0.1/<IP-da-VPS>/" | base64 -w0
```

### 2.4 DNS e certificados — o domínio está na Cloudflare

O passo a passo completo está em [`CLOUDFLARE.md`](CLOUDFLARE.md). O resumo:

| Tipo | Nome | Valor | Proxy |
|---|---|---|---|
| A | `@` | IP da VPS | laranja |
| A | `api` | IP da VPS | laranja |
| CNAME ou A | `www` | `sonoravibe.com` ou o IP | laranja |
| — | `cdn` | criado pelo painel do R2 | — |

Com o proxy da Cloudflare ligado, o desafio **HTTP-01 não funciona**: quem
responde em `/.well-known/acme-challenge/` é a Cloudflare, não a sua VPS. Por
isso os ingresses usam um emissor próprio, por **DNS-01**, em
`k8s/cert-manager/clusterissuer-cloudflare.yaml` — ele não altera o
`letsencrypt-prod` dos seus outros projetos.

Antes do primeiro deploy:

```bash
kubectl create secret generic cloudflare-api-token \
  --namespace cert-manager \
  --from-literal=api-token='<token de zona>'

kubectl apply -f k8s/cert-manager/clusterissuer-cloudflare.yaml
```

### 2.5 Motor de música — hoje o Lyria, ACE-Step depois

Os ConfigMaps estão com `MUSIC_PROVIDER: "lyria"`. É **temporário**: o endpoint
serverless da RunPod ainda não existe, e a API se recusa a subir com `acestep`
sem `RUNPOD_ENDPOINT_ID`.

| | ACE-Step (RunPod) | Lyria (OpenRouter) — atual |
|---|---|---|
| Custo por música | ~US$ 0,008 | ~US$ 0,08 (**10×**) |
| Duração máxima | 8 min no motor (o produto oferece 6) | ~3 min |
| Endpoint próprio | precisa criar | não precisa |

Com `lyria`, os secrets `RUNPOD_API_KEY` e `RUNPOD_ENDPOINT_ID` **não precisam
existir** — eles só são exigidos pelo motor ACE-Step.

#### O que isso quebra, e o que não quebra

A duração padrão é **automática**: quando o usuário não mexe no controle, o
pedido não leva `durationSeconds` e o Lyria atende normalmente, entregando uma
faixa de até ~3 minutos. Esse é o caminho da maioria e continua funcionando.

O problema aparece quando alguém **fixa** uma duração acima de 3 minutos:

| Plano | Duração anunciada | Com Lyria |
|---|---|---|
| Free | 2 min | funciona |
| Pro | 4 min | **falha** se a duração for fixada acima de ~3 min |
| Premier | 6 min | **falha** se a duração for fixada acima de ~3 min |

A falha é limpa — o roteador recusa antes de chamar o modelo e os créditos nem
chegam a ser cobrados —, mas é uma promessa que o produto não cumpre.

> **Antes de abrir para o público pagante**, resolva uma das duas: crie o
> endpoint da RunPod, ou ajuste `maxDurationSeconds` em `packages/shared/src/plans.ts`
> e os textos correspondentes no site. Vender um plano de 6 minutos que entrega
> 3 é o tipo de coisa que gera estorno e reclamação.

Para voltar ao ACE-Step depois: troque as duas linhas `MUSIC_PROVIDER` nos
ConfigMaps da API e do worker, e preencha os dois secrets da RunPod. O código do
provider e a imagem de GPU (`apps/gpu-worker/`) já estão prontos — falta só
construir a imagem e criar o endpoint.

---

## 3. Ordem do primeiro deploy

Antes de tudo, rode o pré-voo na VPS. São só leituras, e cada falha que ele
pega aqui viraria um erro bem mais obscuro depois — um pod em
`CreateContainerConfigError` ou um timeout de rede não dizem a causa.

```bash
bash scripts/pre-deploy.sh
```

1. **Cloudflare** — token e emissor aplicados (seção 2.4). O certificado leva
   alguns minutos e não depende da aplicação, então adiantar aqui economiza espera.

2. **Deploy API** (Actions → Deploy API → *Run workflow*). É o que cria o
   namespace, o Redis e os secrets, e o que falha mais cedo se faltar alguma
   coisa. Ao final, os pods sobem e `/health` responde — **mas as rotas ainda
   dão 500**, porque o banco está vazio.

3. **Schema** (seção 2.2): `bash scripts/criar-schema.sh`. Só agora é possível —
   a imagem da API acabou de ser construída.

4. **Deploy Worker**. O build passa de 10 minutos na primeira vez — a imagem
   leva PyTorch e os pesos do Demucs (~2 GB).

5. **Deploy Web**.

6. **Certificados:**
   ```bash
   kubectl get certificate -n sonora
   # READY=True em sonora-web-tls e sonora-api-tls
   ```

7. **Só agora** mude o SSL da Cloudflare para *Full (strict)*. Antes de o
   certificado existir, esse modo faz a Cloudflare devolver 526.

## 4. Verificação depois do deploy

```bash
kubectl get pods -n sonora
curl -i https://api.sonoravibe.com/health          # 200 com database e redis ok
curl -s https://api.sonoravibe.com/plans | head    # catálogo público
curl -I https://sonoravibe.com                     # 200

# Todas as 54 rotas documentadas existem e as protegidas recusam quem não tem sessão
node scripts/verify-routes.mjs https://api.sonoravibe.com
```

Consumo real, para ajustar `requests`/`limits` depois de alguns dias:

```bash
kubectl top pods -n sonora
```

---

## 5. Decisões deste deploy que fogem do padrão da skill

Cada uma existe por um motivo concreto:

| O que | Por quê |
|---|---|
| Três workflows, não um | Filtro de caminho por aplicação. Um só redeployaria o worker a cada mudança de CSS, interrompendo gerações. |
| Worker com `strategy: Recreate` | Num rolling update os dois pods consomem a mesma fila e o antigo pode pegar um job que o novo já começou. Sem HTTP, não há downtime visível. |
| Worker com `terminationGracePeriodSeconds: 900` | O desligamento espera os jobs ativos. Cortar antes devolveria o job à fila e o usuário pagaria a música duas vezes. |
| Worker com probe `exec`, não HTTP | Ele não escuta em porta nenhuma; um probe HTTP falharia sempre e reiniciaria o pod em laço. O probe olha a idade de `/tmp/heartbeat`. |
| Worker sem HPA | Escalar consumidor de fila por CPU faz ele subir réplica justamente quando o FFmpeg está ocupando a CPU — e a VPS não tem folga para isso. |
| API com 512Mi de limite | Com os 256Mi do padrão o pod morre por OOM na subida: 18 entidades do TypeORM, pool do Postgres, três filas e uma assinatura de pub/sub. |
| API com grace period de 60s | O SSE mantém conexões abertas por minutos; 30s cortaria o stream de quem acompanha uma geração. |
| Redis com `appendonly yes` | As filas do BullMQ não podem sumir num restart: um job perdido é uma música paga e não entregue. |
| Sem a porta 5432 no egress público | O Postgres é o do cluster. Deixar a 5432 aberta para a internet seria um caminho de saída de dados sem necessidade. |

---

## 6. Quando algo falha

| Sintoma | Causa provável | Como conferir |
|---|---|---|
| `CreateContainerConfigError` | o Secret não existe ainda | `kubectl get secret -n sonora` |
| `violates PodSecurity` | UID do Dockerfile ≠ do `securityContext` | `kubectl describe pod` |
| Pod sobe e morre em laço | falta variável; a validação recusa na subida | `kubectl logs -n sonora <pod> --previous` |
| Timeout para o banco ou para a internet | regra faltando na NetworkPolicy | `kubectl describe networkpolicy -n sonora` |
| Certificado não sai | token da Cloudflare sem permissão de DNS Edit | `kubectl describe challenge -n sonora` |
| Erro 521/522/526 da Cloudflare | firewall, origem fora, ou SSL strict cedo demais | [`CLOUDFLARE.md` §6](CLOUDFLARE.md) |
| Progresso da geração não aparece | SSE bufferizado por algum middleware | testar `curl -N https://api.sonoravibe.com/generations/stream` |
| Frontend chamando `localhost:3001` | `NEXT_PUBLIC_API_URL` não entrou no build | a variável é fixada no build, não no ConfigMap |

A tabela completa de diagnóstico está em
`~/.claude/skills/deploy-github-k3s-hostinger/references/troubleshooting.md`.
