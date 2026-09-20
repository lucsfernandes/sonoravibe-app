# Sonora — API (NestJS)
#
# O contexto do build é a RAIZ do monorepo, não esta pasta: o pnpm precisa do
# lockfile e do pnpm-workspace.yaml para resolver os pacotes internos
# (@sonora/db, @sonora/shared, @sonora/storage).
#
#   docker build -f apps/api/Dockerfile -t sonora-api .

# ---------------------------------------------------------------- dependências
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable

# Só os manifestos primeiro: enquanto eles não mudarem, o Docker reaproveita a
# camada de instalação, que é de longe a mais cara do build.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/

RUN pnpm install --frozen-lockfile --filter @sonora/api...

# --------------------------------------------------------------------- runtime
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# dumb-init como PID 1: repassa o SIGTERM ao Node e recolhe processos órfãos.
# Sem um init, sinais enviados ao PID 1 não têm tratamento padrão no container.
RUN apk add --no-cache dumb-init

# UID numérico 1001, igual ao do securityContext do Deployment. O PSA
# "restricted" rejeita o pod se os dois não baterem.
RUN addgroup -g 1001 -S sonora && adduser -u 1001 -S sonora -G sonora

COPY --from=deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=deps --chown=1001:1001 /app/apps/api/node_modules ./apps/api/node_modules
# Os pacotes internos têm node_modules próprios (o pnpm cria um por workspace,
# com links para o .pnpm da raiz). Sem eles, `packages/db` não encontra o
# typeorm e o processo morre com MODULE_NOT_FOUND no primeiro import.
COPY --from=deps --chown=1001:1001 /app/packages ./packages

COPY --chown=1001:1001 .swcrc ./.swcrc
# Sobrepõe o código-fonte por cima do que veio do estágio de dependências: o
# COPY mescla diretórios, então os node_modules acima permanecem.
COPY --chown=1001:1001 packages ./packages
COPY --chown=1001:1001 apps/api/src ./apps/api/src
COPY --chown=1001:1001 apps/api/package.json ./apps/api/package.json
# O tsconfig.json NÃO é opcional aqui: o @swc-node/register tira dele o
# `experimentalDecorators` e o `emitDecoratorMetadata`. Sem o arquivo, o SWC
# compila sem suporte a decorator e o processo morre com "Expression expected"
# na primeira linha de @Module/@Entity — um erro que não aparece em
# desenvolvimento, onde o arquivo sempre está presente.
COPY --chown=1001:1001 apps/api/tsconfig.json ./apps/api/tsconfig.json

# O TypeScript é transpilado na subida pelo @swc-node/register, usando o .swcrc
# da raiz. É ele que garante o `emitDecoratorMetadata` de que a injeção de
# dependência do Nest depende — tsx e esbuild não emitem esses metadados.
# O custo é alguns segundos a mais de boot, absorvidos pelo startupProbe.
USER 1001
EXPOSE 3001

# O diretório de trabalho é o da aplicação, não a raiz: num monorepo pnpm o
# @swc-node/register fica em apps/api/node_modules, e rodando de /app o Node
# procuraria só em /app/node_modules e falharia com MODULE_NOT_FOUND.
# O .swcrc da raiz continua sendo encontrado, porque o SWC sobe a árvore a
# partir do arquivo que está compilando.
WORKDIR /app/apps/api

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "-r", "@swc-node/register", "src/main.ts"]
