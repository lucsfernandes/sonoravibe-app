# Sonora

SaaS de geração de música com IA. Monorepo pnpm com quatro aplicações:

| Pasta | O que é | Onde roda em produção |
|---|---|---|
| `apps/web` | Interface Next.js (PT-BR / EN) | k3s — `sonoravibe.com` |
| `apps/api` | API NestJS (REST + SSE) | k3s — `api.sonoravibe.com` |
| `apps/worker` | Consumidor de filas (FFmpeg, Demucs) | k3s — interno, sem ingress |
| `apps/gpu-worker` | Handler ACE-Step em GPU | RunPod Serverless |

Documentação: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) e [`docs/API.md`](docs/API.md).
Coleção do Postman em [`docs/postman/`](docs/postman/).

## Como o domínio é dividido

| URL | O que serve |
|---|---|
| `sonoravibe.com/` | Site institucional — HTML estático de `apps/web/public/`, servido por um rewrite. Ver [`docs/SITE-INSTITUCIONAL.md`](docs/SITE-INSTITUCIONAL.md) |
| `sonoravibe.com/inicio` | Home do aplicativo (feed e campo de criação) |
| `sonoravibe.com/criar`, `/explorar`, … | O resto do aplicativo |
| `api.sonoravibe.com` | A API |

## O que o produto faz

Gerar música por descrição (aba Simples), por letra e controles finos (Avançado) ou efeitos
curtos (Sons); acompanhar a geração ao vivo por SSE; ouvir num player que sobrevive à troca de
página; publicar, explorar, curtir, comentar num instante da faixa e seguir gente; organizar em
workspaces e playlists; editar o áudio (cortar, fades, velocidade, reverter, normalizar,
separar stems); derivar novas faixas (estender, remix, substituir trecho, gerar capa); baixar
em cinco formatos, um a um ou em lote; e pagar por plano ou pacote avulso.

Créditos são um livro-razão append-only: reserva antes de enfileirar, confirma no sucesso,
estorna na falha — com `SELECT ... FOR UPDATE` para cinco gerações simultâneas não gastarem o
mesmo saldo.

## O que falta

| Pendência | Por quê importa |
|---|---|
| Endpoint ACE-Step na RunPod | O Lyria entrega ~3 min. Enquanto não existir, `ENGINE_MAX_DURATION_SECONDS` segura o que os planos anunciam, e Pro/Premier não entregam os 4 e 8 min do plano |
| Migrations versionadas do TypeORM | Hoje o schema nasce de um `synchronize` manual (`scripts/criar-schema.sh`). Funciona uma vez; não serve para evoluir o schema com dados dentro |
| Testes na `apps/web` | Não há vitest configurado ali. API e worker têm 74 testes; a interface é coberta só por teste manual no navegador |

## Desenvolvimento

```bash
pnpm install
pnpm infra:up        # Postgres, Redis e MinIO em contêiner
pnpm --filter @sonora/api dev
pnpm --filter @sonora/worker dev
pnpm --filter @sonora/web dev
```

### Por que existe `allowBuilds` no pnpm-workspace.yaml

O pnpm 12 não executa scripts de instalação de dependência sem aprovação
explícita — uma proteção contra pacote malicioso rodando código na máquina de
quem instala. O `@swc/core` precisa desse script para instalar o binário nativo,
e sem ele a API e o worker não sobem (`@swc-node/register` falha ao carregar).
No terminal isso aparece só como aviso; dentro do build do Docker o pnpm falha
com `ERR_PNPM_IGNORED_BUILDS` e a imagem não sai. A lista aprova nominalmente os
pacotes necessários, em vez de liberar tudo.

## Deploy

`git push` na `main` dispara os workflows em `.github/workflows/`, com filtro de
caminho: mexer só no frontend não redeploya a API nem o worker.
Passo a passo e pré-requisitos em [`docs/DEPLOY.md`](docs/DEPLOY.md).
O domínio está na Cloudflare e a VPS na Hostinger: como ligar os dois, e as
configurações da Cloudflare que afetam este app, em
[`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md).
