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
