# Sonora — worker de filas (BullMQ)
#
# Esta é a imagem mais pesada do projeto, e por um motivo: além do Node, ela
# carrega FFmpeg (conversão e edição) e Demucs (separação de stems), que é
# Python com PyTorch. Sem o Demucs, a rota de stems aceita o pedido e o job
# falha — é melhor a imagem ser grande do que a funcionalidade ser mentira.
#
#   docker build -f apps/worker/Dockerfile -t sonora-worker .

# ---------------------------------------------------------------- dependências
FROM node:24-bookworm-slim AS deps
WORKDIR /app

RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/

RUN pnpm install --frozen-lockfile --filter @sonora/worker...

# --------------------------------------------------------------------- runtime
# Debian slim, e não Alpine: o PyTorch (dependência do Demucs) não publica
# wheels para musl, e compilá-lo do zero levaria dezenas de minutos por build.
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    # Python não grava .pyc: o root FS é somente leitura e a escrita falharia.
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Onde o Demucs guarda os pesos do modelo. Vai para dentro da imagem, e não
    # para um volume, para o primeiro job não pagar o download de ~300 MB.
    TORCH_HOME=/opt/torch

RUN apt-get update && apt-get install --no-install-recommends -y \
      ffmpeg \
      python3 \
      python3-pip \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

# A roda de CPU do PyTorch: a versão padrão traz CUDA e passa de 2 GB, inútil
# numa VPS sem GPU (a GPU de verdade é a da RunPod, fora do cluster).
RUN pip3 install --no-cache-dir --break-system-packages \
      --index-url https://download.pytorch.org/whl/cpu \
      torch torchaudio \
    && pip3 install --no-cache-dir --break-system-packages demucs

# Baixa os pesos do htdemucs durante o build. Sem isto, o primeiro pedido de
# stems esperaria o download — e falharia, porque o root FS é somente leitura.
RUN mkdir -p /opt/torch && \
    python3 -c "from demucs.pretrained import get_model; get_model('htdemucs')" && \
    chmod -R a+rX /opt/torch

RUN groupadd -g 1001 sonora && useradd -u 1001 -g 1001 -m -s /bin/sh sonora

COPY --from=deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=deps --chown=1001:1001 /app/apps/worker/node_modules ./apps/worker/node_modules
# Os pacotes internos têm node_modules próprios (o pnpm cria um por workspace,
# com links para o .pnpm da raiz). Sem eles, `packages/db` não encontra o
# typeorm e o processo morre com MODULE_NOT_FOUND no primeiro import.
COPY --from=deps --chown=1001:1001 /app/packages ./packages

COPY --chown=1001:1001 .swcrc ./.swcrc
# Sobrepõe o código-fonte por cima do que veio do estágio de dependências: o
# COPY mescla diretórios, então os node_modules acima permanecem.
COPY --chown=1001:1001 packages ./packages
COPY --chown=1001:1001 apps/worker/src ./apps/worker/src
COPY --chown=1001:1001 apps/worker/package.json ./apps/worker/package.json
# O tsconfig.json NÃO é opcional aqui: o @swc-node/register tira dele o
# `experimentalDecorators` e o `emitDecoratorMetadata`. Sem o arquivo, o SWC
# compila sem suporte a decorator e o processo morre com "Expression expected"
# na primeira linha de @Module/@Entity — um erro que não aparece em
# desenvolvimento, onde o arquivo sempre está presente.
COPY --chown=1001:1001 apps/worker/tsconfig.json ./apps/worker/tsconfig.json

USER 1001

# O diretório de trabalho é o da aplicação, não a raiz: num monorepo pnpm o
# @swc-node/register fica em apps/worker/node_modules, e rodando de /app o Node
# procuraria só em /app/node_modules e falharia com MODULE_NOT_FOUND.
# O .swcrc da raiz continua sendo encontrado, porque o SWC sobe a árvore a
# partir do arquivo que está compilando.
WORKDIR /app/apps/worker

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "-r", "@swc-node/register", "src/main.ts"]
