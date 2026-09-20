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

### 2.2 Schema das tabelas

`DB_SYNCHRONIZE` é `false` em produção — o `synchronize` do TypeORM apaga coluna
que sumiu do código, e aqui isso significaria perder música de usuário. O schema
precisa ser criado explicitamente, **uma vez**, antes do primeiro deploy:

```bash
kubectl run sonora-schema --rm -it --restart=Never -n sonora \
  --image=<user>/sonora-api:<sha> \
  --env=DATABASE_URL='<a URL do banco>' \
  --env=DB_SYNCHRONIZE=true --env=NODE_ENV=development \
  --command -- node -r @swc-node/register src/main.ts
```

Suba, confira que as tabelas nasceram e encerre. As tabelas `user`, `session`,
`account` e `verification` são do Better Auth e nascem pelas migrations dele, que
rodam nesse mesmo comando, antes das do domínio.

> Passo seguinte natural, ainda não feito: trocar isso por migrations
> versionadas do TypeORM e um `Job` que roda antes do Deployment.

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
| `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` | api, worker | ACE-Step |
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

### 2.5 RunPod (motor de música)

O `MUSIC_PROVIDER` do ConfigMap está em `acestep`, mas **o endpoint da RunPod
ainda não existe**. Até criá-lo e preencher `RUNPOD_ENDPOINT_ID`, a API falha na
subida com a mensagem da própria validação de configuração.

Duas saídas, escolha uma:

- Criar o endpoint serverless na RunPod com a imagem de `apps/gpu-worker/` e
  preencher os dois secrets.
- Subir com `MUSIC_PROVIDER: "lyria"` no ConfigMap, usando o OpenRouter. Funciona
  hoje, mas custa cerca de 10× mais por música e limita a duração a ~3 minutos.

---

## 3. Ordem do primeiro deploy

1. Aplicar o Redis: ele precisa existir antes da API. O `deploy-api.yml` já faz
   isso (`kubectl apply -k k8s/redis`), mas dá para adiantar à mão.
2. Rodar o **Deploy API**, por `workflow_dispatch`. É o que cria o namespace e
   os secrets, e o que falha mais cedo se algo estiver faltando.
3. Rodar o **Deploy Worker**. O build passa de 10 minutos na primeira vez: a
   imagem leva PyTorch e os pesos do Demucs (~2 GB).
4. Rodar o **Deploy Web**.
5. Conferir os certificados:
   ```bash
   kubectl get certificate -n sonora
   # READY=True nos dois (sonora-web-tls e sonora-api-tls)
   ```
6. **Só agora** mudar o modo SSL da Cloudflare para *Full (strict)*. Antes de o
   certificado existir, esse modo faz a Cloudflare devolver erro 526.

---

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
