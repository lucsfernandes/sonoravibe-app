# Worker de capas do Sonora para a RunPod Serverless: FLUX.2 [klein] 4B + handler.
#
# Base fixada por DIGEST (PyTorch 2.6.0, CUDA 12.4, publicada em 29/01/2025):
# uma tag móvel trocaria a pilha de CUDA sem ninguém gerar capas de novo.
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee

ENV FLUX_MODEL_DIR=/models/flux2-klein-4b \
    PYTHONUNBUFFERED=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false

COPY requirements.txt /worker/requirements.txt
RUN pip install --no-cache-dir -r /worker/requirements.txt

# Pesos DENTRO da imagem (~16 GB): baixar no boot somaria minutos a cada cold start.
# O repositório não é "gated": baixa sem token, como o ACE-Step. Licença Apache 2.0.
#
# Só o formato diffusers: `flux-2-klein-4b.safetensors` na raiz é o mesmo
# transformer num arquivo único (mais 7,8 GB à toa).
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download('black-forest-labs/FLUX.2-klein-4B', local_dir='/models/flux2-klein-4b', \
    allow_patterns=['model_index.json', 'scheduler/*', 'text_encoder/*', 'tokenizer/*', \
                    'transformer/*', 'vae/*'])" \
    && du -sh /models/flux2-klein-4b/*

COPY handler.py /worker/handler.py

CMD ["python", "-u", "/worker/handler.py"]
