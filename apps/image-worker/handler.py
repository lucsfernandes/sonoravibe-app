"""
Worker serverless da RunPod que desenha as capas com o FLUX.2 [klein] 4B.

Contrato (entrada em job["input"]):
    prompt   str, obrigatório   descrição da capa (até 2000 caracteres), já em forma de pedido
    width    int                256–1440, múltiplo de 16; padrão 1024
    height   int                256–1440, múltiplo de 16; padrão 1024
    steps    int                1–8; padrão 4 (o klein é destilado para 4 passos)
    seed     int | None         reprodutibilidade (só vale no mesmo tipo de GPU)
    quality  int                qualidade do JPEG, 60–95; padrão 90

Saída:
    {"image_base64": str, "mime_type": "image/jpeg", "width", "height", "seed",
     "timings": {...}, "worker": {...}}

Decisões:
  - FLUX.2 [klein] 4B, e não o FLUX.1 [schnell]: mesma licença (Apache 2.0,
    uso comercial), mesmo fabricante, mas cabe inteiro numa GPU de 24 GB em bf16
    (~16 GB de pesos) sem quantização, e o repositório não pede token.
  - Endpoint PRÓPRIO, fora do worker de música: ACE-Step e klein juntos não cabem
    numa GPU de 24 GB.
  - Tudo na GPU, sem offload para a CPU: offload deixaria cada capa várias vezes
    mais lenta, e sobra memória.
  - A imagem volta na própria resposta, em base64: um JPEG de 1024² tem
    ~200–400 KB, longe do limite de 10–30 MB da resposta da RunPod. Sem URL
    pré-assinada, sem credencial do bucket aqui dentro.
  - Os modelos carregam na IMPORTAÇÃO do módulo, não no primeiro job, pelo mesmo
    motivo do worker de música: é o que o FlashBoot congela.
  - O klein é destilado: guidance_scale=1.0 (o do exemplo oficial) e sem prompt
    negativo. "Sem texto" no pedido ajuda pouco; o chamador evita pôr no prompt o
    que não quer desenhado.

Teste local:
    python handler.py --test_input '{"input": {"prompt": "..."}}'
"""

from __future__ import annotations

import base64
import io
import os
import time
import traceback
from typing import Any

import runpod
import torch
from diffusers import Flux2KleinPipeline

MODEL_DIR = os.environ.get("FLUX_MODEL_DIR", "/models/flux2-klein-4b")

DEFAULT_SIZE = 1024
MIN_SIZE, MAX_SIZE = 256, 1440
DEFAULT_STEPS = 4
MAX_STEPS = 8
MAX_PROMPT = 2000
# O exemplo oficial do klein usa guidance 1.0: o modelo é destilado.
GUIDANCE_SCALE = 1.0
DEFAULT_QUALITY = 90


class InputError(ValueError):
    """Erro do chamador: repetir o job com a mesma entrada não adianta."""


# ---------------------------------------------------------------------------
# Carga do modelo — roda uma vez, na inicialização do worker
# ---------------------------------------------------------------------------


def _load() -> tuple[Any, dict[str, Any]]:
    started = time.time()
    pipe = Flux2KleinPipeline.from_pretrained(MODEL_DIR, torch_dtype=torch.bfloat16)
    pipe.to("cuda" if torch.cuda.is_available() else "cpu")

    info: dict[str, Any] = {
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "model": "FLUX.2-klein-4B",
        "dtype": "bf16",
        "load_s": round(time.time() - started, 1),
    }
    if torch.cuda.is_available():
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        info["vram_total_gb"] = round(total_bytes / 1024**3, 1)
        info["vram_free_after_load_gb"] = round(free_bytes / 1024**3, 1)
    print(f"[sonora-capa] modelo carregado: {info}", flush=True)
    return pipe, info


PIPE, WORKER_INFO = _load()
_served_first_job = False


# ---------------------------------------------------------------------------
# Validação
# ---------------------------------------------------------------------------


def _int_in(data: dict, key: str, lo: int, hi: int, default: int) -> int:
    value = data.get(key)
    if value is None:
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise InputError(f"'{key}' precisa ser inteiro")
    if not lo <= number <= hi:
        raise InputError(f"'{key}' fora do intervalo {lo}–{hi}: {number}")
    return number


def _parse_input(data: dict) -> dict:
    if not isinstance(data, dict):
        raise InputError("input precisa ser um objeto")

    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        raise InputError("'prompt' é obrigatório")
    if len(prompt) > MAX_PROMPT:
        raise InputError(f"'prompt' passa de {MAX_PROMPT} caracteres")

    width = _int_in(data, "width", MIN_SIZE, MAX_SIZE, DEFAULT_SIZE)
    height = _int_in(data, "height", MIN_SIZE, MAX_SIZE, DEFAULT_SIZE)
    if width % 16 or height % 16:
        raise InputError("'width' e 'height' precisam ser múltiplos de 16")

    seed = data.get("seed")
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            raise InputError("'seed' precisa ser inteiro")

    return {
        "prompt": prompt,
        "width": width,
        "height": height,
        "steps": _int_in(data, "steps", 1, MAX_STEPS, DEFAULT_STEPS),
        "seed": seed,
        "quality": _int_in(data, "quality", 60, 95, DEFAULT_QUALITY),
    }


def _to_jpeg(image: Any, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


def handler(job: dict) -> dict:
    global _served_first_job
    cold_start = not _served_first_job
    _served_first_job = True

    try:
        req = _parse_input(job.get("input") or {})
    except InputError as err:
        return {"error": f"entrada inválida: {err}"}

    try:
        seed = req["seed"] if req["seed"] is not None else int.from_bytes(os.urandom(4), "big")
        generator = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu").manual_seed(seed)

        started = time.time()
        result = PIPE(
            prompt=req["prompt"],
            width=req["width"],
            height=req["height"],
            num_inference_steps=req["steps"],
            guidance_scale=GUIDANCE_SCALE,
            generator=generator,
        )
        generate_s = round(time.time() - started, 2)

        image = result.images[0]
        jpeg = _to_jpeg(image, req["quality"])
        return {
            "image_base64": base64.b64encode(jpeg).decode("ascii"),
            "mime_type": "image/jpeg",
            "width": req["width"],
            "height": req["height"],
            "seed": seed,
            "timings": {"generate_s": generate_s},
            "worker": {**WORKER_INFO, "cold_start": cold_start},
        }
    except torch.cuda.OutOfMemoryError:
        return {"error": "GPU sem memória", "refresh_worker": True}
    except Exception as err:  # noqa: BLE001 — o job precisa sempre devolver um erro legível
        traceback.print_exc()
        return {"error": f"{type(err).__name__}: {err}"}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
