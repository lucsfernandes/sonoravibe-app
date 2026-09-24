# Worker GPU do Sonora para a RunPod Serverless: ACE-Step 1.5 + handler.
#
# Base fixada por DIGEST, não por tag: é exatamente a imagem medida no
# benchmark da L4 em 19/09/2026 (tags latest, 0.1.8 e dce6214 apontavam para
# este digest naquele dia; dce6214 é o commit de 18/05/2026 e já traz o código
# do XL). Uma tag móvel mudaria o modelo em produção sem ninguém medir de novo
# o ritmo e o custo.
FROM ghcr.io/ace-step/ace-step-1.5@sha256:95652cd780c78a1b1a7f6f0335530430f0ae53d96c7c12d59f9f39fa23d38567

# Modelo: DiT XL-turbo (4B, 8 passos, sem CFG) + LM 1.7B. É a configuração que
# soou limpa numa escuta às cegas de 29 faixas do mesmo prompt
# (docs/BENCHMARK-QUALIDADE.md); o XL-SFT e o LM 4B soaram com ruído e sem
# coesão. Roda numa GPU de 24 GB.
#
# OFFLOAD_TO_CPU=true tira só o encoder de texto e o VAE da GPU entre as etapas
# (o DiT e o LM ficam). Sem ele, 2 faixas de 6 min são recusadas numa GPU de
# 24 GB pela checagem prévia de VRAM do ACE-Step (pedia 6,5 GB, havia 6,4);
# com ele passaram, em 59,5 s na RTX 3090 (docs/BENCHMARK-QUALIDADE.md).
ENV ACESTEP_PROJECT_ROOT=/app \
    ACESTEP_CONFIG_PATH=acestep-v15-xl-turbo \
    ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B \
    ACESTEP_LM_BACKEND=vllm \
    ACESTEP_OFFLOAD_TO_CPU=true \
    ACESTEP_OFFLOAD_DIT_TO_CPU=false \
    ACESTEP_LM_OFFLOAD_TO_CPU=false \
    PYTHONUNBUFFERED=1 \
    TOKENIZERS_PARALLELISM=false \
    HF_HUB_DISABLE_TELEMETRY=1

WORKDIR /app

# Pesos DENTRO da imagem. Baixar no boot somaria minutos a cada cold start.
#
#   modelo principal      ~10 GB  VAE, encoder de texto, DiT turbo (2B) e LM 1.7B
#   acestep-v15-xl-turbo  ~20 GB  (fp32 em disco; ~9 GB em bf16 na VRAM)
#
# O modelo principal NÃO pode ser podado para emagrecer a imagem: a
# inicialização do ACE-Step confere todos os componentes dele e, se falta um
# (o turbo, por exemplo), baixa tudo de novo — a cada cold start. Por isso o
# turbo de 2B fica aqui mesmo sem ser o padrão; voltar a ele é só uma variável
# de ambiente (ACESTEP_CONFIG_PATH=acestep-v15-turbo).
#
# O XL-SFT e o LM 4B NÃO estão na imagem de propósito: soaram pior na escuta e
# somariam ~28 GB. Para testá-los de novo, acrescente ao RUN abaixo
# `acestep-download --model acestep-v15-xl-sft` e/ou `--model acestep-5Hz-lm-4B`.
#
# São ~30 GB de pesos: o build pede ~70 GB livres em disco, e um runner padrão
# do GitHub Actions (~14 GB) não comporta — construa e publique de uma máquina
# com disco.
RUN uv run --no-sync acestep-download \
    && uv run --no-sync acestep-download --model acestep-v15-xl-turbo \
    && du -sh /app/checkpoints/*

COPY requirements.txt /worker/requirements.txt
RUN uv pip install --python /app/.venv/bin/python -r /worker/requirements.txt

COPY handler.py /worker/handler.py

# A imagem base sobe a UI Gradio pelo entrypoint próprio; aqui o processo é o handler.
ENTRYPOINT []
CMD ["/app/.venv/bin/python", "-u", "/worker/handler.py"]
