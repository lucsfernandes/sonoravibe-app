# Sonora — interface (Next.js)
#
# Contexto do build: a RAIZ do monorepo.
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.sonoravibe.com -t sonora-web .

# ---------------------------------------------------------------- dependências
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --filter @sonora/web...

# -------------------------------------------------------------------- build
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable

# As variáveis NEXT_PUBLIC_* são fixadas no BUNDLE durante o build, não lidas em
# tempo de execução. Por isso vêm como build-arg e NÃO no ConfigMap: colocá-las
# lá não teria efeito nenhum, e o app apontaria para o localhost do build.
ARG NEXT_PUBLIC_API_URL=https://api.sonoravibe.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm --filter @sonora/web build

# --------------------------------------------------------------------- runtime
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Sem isto o servidor escuta em localhost e os probes do Kubernetes, que
    # chegam pelo IP do pod, recebem "connection refused".
    HOSTNAME=0.0.0.0

RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S sonora && adduser -u 1001 -S sonora -G sonora

# A saída `standalone` do Next traz só o necessário para rodar: o servidor e as
# dependências que ele realmente importa, sem o node_modules inteiro.
COPY --from=builder --chown=1001:1001 /app/apps/web/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=1001:1001 /app/apps/web/public ./apps/web/public

USER 1001
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
