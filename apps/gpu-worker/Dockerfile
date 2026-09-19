# Worker GPU do Sonora para a RunPod Serverless: ACE-Step 1.5 + handler.
#
# Base fixada por DIGEST, não por tag: é exatamente a imagem medida no
# benchmark da L4 em 19/09/2026 (tags latest, 0.1.8 e dce6214 apontavam para
# este digest naquele dia). Uma tag móvel mudaria o modelo em produção sem
# ninguém medir de novo o ritmo e o custo.
FROM ghcr.io/ace-step/ace-step-1.5@sha256:95652cd780c78a1b1a7f6f0335530430f0ae53d96c7c12d59f9f39fa23d38567

ENV ACESTEP_PROJECT_ROOT=/app \
    ACESTEP_CONFIG_PATH=acestep-v15-turbo \
    ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B \
    ACESTEP_LM_BACKEND=vllm \
    ACESTEP_OFFLOAD_TO_CPU=false \
    ACESTEP_OFFLOAD_DIT_TO_CPU=false \
    ACESTEP_LM_OFFLOAD_TO_CPU=false \
    PYTHONUNBUFFERED=1 \
    TOKENIZERS_PARALLELISM=false \
    HF_HUB_DISABLE_TELEMETRY=1

WORKDIR /app

# Pesos DENTRO da imagem (~9,5 GB: DiT turbo, VAE, encoder de texto e LM 1.7B).
# Baixar no boot somaria minutos a cada cold start; com os pesos aqui o cold
# start é só a carga dos modelos (56 s medidos na L4).
RUN uv run --no-sync acestep-download \
    && du -sh /app/checkpoints

COPY requirements.txt /worker/requirements.txt
RUN uv pip install --python /app/.venv/bin/python -r /worker/requirements.txt

COPY handler.py /worker/handler.py

# A imagem base sobe a UI Gradio pelo entrypoint próprio; aqui o processo é o handler.
ENTRYPOINT []
CMD ["/app/.venv/bin/python", "-u", "/worker/handler.py"]
