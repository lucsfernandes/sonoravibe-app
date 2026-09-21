"""
Worker serverless da RunPod que gera música com o ACE-Step 1.5.

Contrato (entrada em job["input"]):
    caption          str, obrigatório   estilo/descrição (até 512 caracteres)
    lyrics           str                letra com marcadores [Verse]/[Chorus]; vazio = sem letra
    instrumental     bool               força instrumental
    duration         float | None       10–480 s; None = o modelo decide pelo tamanho da letra
    bpm              int | None         30–300; None = automático
    keyscale         str | None         ex. "C Major", "Am"; None = automático
    vocal_language   str                código do idioma ("pt", "en"...); padrão "unknown"
    seed             int | None         reprodutibilidade (só vale no mesmo tipo de GPU)
    batch_size       int                1 ou 2 variações por pedido
    task_type        str                "text2music" | "cover" | "repaint"
    src_audio_url    str                obrigatório para cover/repaint
    repainting_start float              repaint: início do trecho, em segundos
    repainting_end   float              repaint: fim do trecho (-1 = até o fim)
    audio_cover_strength float          cover: 0–1
    uploads          list[{url, storage_key}]  um destino pré-assinado no R2 por variação

Saída:
    {"tracks": [{storage_key, size_bytes, duration_ms, format, sample_rate, bit_depth, seed}],
     "metadata": {...}, "timings": {...}, "worker": {...}}

Decisões — todas vêm de medições em docs/ARQUITETURA.md:
  - Os modelos carregam na IMPORTAÇÃO do módulo, não no primeiro job. É o que
    permite ao FlashBoot da RunPod congelar um worker já carregado; carregando
    no primeiro job, todo cold start pagaria os 56 s de carga de novo.
  - `thinking=True` é obrigatório em text2music. Sem ele o LM não gera o
    esqueleto rítmico e os instrumentos saem descompassados (variação entre
    batidas 4,67% contra 1,90%).
  - Se o LM não carregar, o worker FALHA em vez de seguir sem ele. O servidor
    oficial segue em silêncio sem o LM, e isso produziria música descompassada
    sem nenhum erro visível.
  - O áudio sobe direto no R2 via URL pré-assinada: a resposta da RunPod é
    limitada a 10–30 MB e um master de 4 min passa disso.
  - Pedimos WAV float32 e convertemos para FLAC 24-bit aqui. O FLAC nativo do
    ACE-Step sai com a profundidade padrão do soundfile (16-bit).
  - A seed vai em GenerationConfig.seeds. Na versão da imagem oficial
    (0.1.8), GenerationParams.seed é descartado em silêncio.

Teste local (sem RunPod), no ambiente do ACE-Step:
    python handler.py --test_input '{"input": {...}}'
    python handler.py --rp_serve_api --rp_api_port 8008   # imita /run, /runsync, /status
"""

from __future__ import annotations

import os
import shutil
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

import requests
import runpod
import soundfile as sf
import torch

from acestep.constants import TASK_INSTRUCTIONS
from acestep.handler import AceStepHandler
from acestep.inference import GenerationConfig, GenerationParams, generate_music
from acestep.llm_inference import LLMHandler

# ---------------------------------------------------------------------------
# Configuração (tudo sobrescrevível por env para o teste local em 8 GB)
# ---------------------------------------------------------------------------

PROJECT_ROOT = os.environ.get("ACESTEP_PROJECT_ROOT", "/app")
CONFIG_PATH = os.environ.get("ACESTEP_CONFIG_PATH", "acestep-v15-turbo")
LM_MODEL_PATH = os.environ.get("ACESTEP_LM_MODEL_PATH", "acestep-5Hz-lm-1.7B")
LM_BACKEND = os.environ.get("ACESTEP_LM_BACKEND", "vllm")


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# Em GPU de 24 GB nada precisa de offload. Na RTX 4060 (8 GB) do teste local, sim.
OFFLOAD_TO_CPU = _env_bool("ACESTEP_OFFLOAD_TO_CPU", False)
OFFLOAD_DIT_TO_CPU = _env_bool("ACESTEP_OFFLOAD_DIT_TO_CPU", False)
LM_OFFLOAD_TO_CPU = _env_bool("ACESTEP_LM_OFFLOAD_TO_CPU", False)

MIN_DURATION = 10.0
# Teto com o LM ligado, segundo o gpu_config do ACE-Step. Os 10 min anunciados
# exigem o LM desligado — e sem LM volta o descompasso.
MAX_DURATION = 480.0
MAX_CAPTION = 512
MAX_LYRICS = 4096

# Cronograma de difusão do turbo usado pelo servidor oficial — é a configuração
# em que medimos o ritmo corrigido. Não trocar sem medir de novo.
TURBO_TIMESTEPS = [0.97, 0.76, 0.615, 0.5, 0.395, 0.28, 0.18, 0.085, 0.0]

SUPPORTED_TASKS = {"text2music", "cover", "repaint"}
# Estas tarefas usam o áudio de origem; o LM é pulado nelas de qualquer forma.
AUDIO_TASKS = {"cover", "repaint"}

UPLOAD_ATTEMPTS = 3
UPLOAD_TIMEOUT_S = 300


class InputError(ValueError):
    """Erro do chamador: repetir o job com a mesma entrada não adianta."""


# ---------------------------------------------------------------------------
# Carga dos modelos — roda uma vez, na inicialização do worker
# ---------------------------------------------------------------------------


def _load_models() -> tuple[AceStepHandler, LLMHandler, dict[str, Any]]:
    started = time.time()

    dit = AceStepHandler()
    status, ok = dit.initialize_service(
        project_root=PROJECT_ROOT,
        config_path=CONFIG_PATH,
        device="auto",
        use_flash_attention=True,
        compile_model=False,
        offload_to_cpu=OFFLOAD_TO_CPU,
        offload_dit_to_cpu=OFFLOAD_DIT_TO_CPU,
    )
    if not ok:
        raise RuntimeError(f"DiT não carregou: {status}")

    llm = LLMHandler()
    backend = LM_BACKEND
    lm_status, lm_ok = llm.initialize(
        checkpoint_dir=os.path.join(PROJECT_ROOT, "checkpoints"),
        lm_model_path=LM_MODEL_PATH,
        backend=backend,
        device="auto",
        offload_to_cpu=LM_OFFLOAD_TO_CPU,
        dtype=None,
    )
    # vllm é mais rápido, mas pode falhar em alguns drivers. pt é o plano B.
    if not lm_ok and backend != "pt":
        print(f"[sonora] LM com backend {backend} falhou ({lm_status}); tentando pt", flush=True)
        backend = "pt"
        lm_status, lm_ok = llm.initialize(
            checkpoint_dir=os.path.join(PROJECT_ROOT, "checkpoints"),
            lm_model_path=LM_MODEL_PATH,
            backend=backend,
            device="auto",
            offload_to_cpu=LM_OFFLOAD_TO_CPU,
            dtype=None,
        )
    if not lm_ok:
        # Sem LM não há thinking, e sem thinking a música sai descompassada.
        raise RuntimeError(f"LM não carregou com nenhum backend: {lm_status}")

    info = {
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "dit": CONFIG_PATH,
        "lm": LM_MODEL_PATH,
        "lm_backend": backend,
        "load_s": round(time.time() - started, 1),
    }
    print(f"[sonora] modelos carregados: {info}", flush=True)
    return dit, llm, info


DIT, LLM, WORKER_INFO = _load_models()
# Só o primeiro job depois da carga é um cold start.
_served_first_job = False


# ---------------------------------------------------------------------------
# Validação
# ---------------------------------------------------------------------------


def _optional_number(data: dict, key: str, lo: float, hi: float, as_int: bool = False):
    value = data.get(key)
    if value is None:
        return None
    try:
        number = int(value) if as_int else float(value)
    except (TypeError, ValueError):
        raise InputError(f"'{key}' precisa ser numérico")
    if not lo <= number <= hi:
        raise InputError(f"'{key}' fora do intervalo {lo}–{hi}: {number}")
    return number


def _parse_input(data: dict) -> dict:
    if not isinstance(data, dict):
        raise InputError("input precisa ser um objeto")

    task_type = data.get("task_type", "text2music")
    if task_type not in SUPPORTED_TASKS:
        raise InputError(f"task_type não suportado: {task_type}")

    caption = (data.get("caption") or "").strip()
    if not caption:
        raise InputError("'caption' é obrigatório")
    if len(caption) > MAX_CAPTION:
        raise InputError(f"'caption' passa de {MAX_CAPTION} caracteres")

    lyrics = (data.get("lyrics") or "").strip()
    if len(lyrics) > MAX_LYRICS:
        raise InputError(f"'lyrics' passa de {MAX_LYRICS} caracteres")

    batch_size = int(data.get("batch_size") or 1)
    if batch_size not in (1, 2):
        raise InputError("'batch_size' precisa ser 1 ou 2")

    uploads = data.get("uploads") or []
    if len(uploads) != batch_size:
        raise InputError(
            f"'uploads' precisa ter um destino por variação ({batch_size}), veio {len(uploads)}"
        )
    for upload in uploads:
        if not upload.get("url") or not upload.get("storage_key"):
            raise InputError("cada upload precisa de 'url' e 'storage_key'")

    src_audio_url = data.get("src_audio_url")
    if task_type in AUDIO_TASKS and not src_audio_url:
        raise InputError(f"'{task_type}' exige 'src_audio_url'")

    seed = data.get("seed")
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            raise InputError("'seed' precisa ser inteiro")

    return {
        "task_type": task_type,
        "caption": caption,
        "lyrics": lyrics,
        "instrumental": bool(data.get("instrumental", False)),
        "duration": _optional_number(data, "duration", MIN_DURATION, MAX_DURATION),
        "bpm": _optional_number(data, "bpm", 30, 300, as_int=True),
        "keyscale": (data.get("keyscale") or "").strip(),
        "vocal_language": (data.get("vocal_language") or "unknown").strip(),
        "seed": seed,
        "batch_size": batch_size,
        "uploads": uploads,
        "src_audio_url": src_audio_url,
        "repainting_start": float(data.get("repainting_start") or 0.0),
        "repainting_end": float(data.get("repainting_end") if data.get("repainting_end") is not None else -1),
        "audio_cover_strength": float(data.get("audio_cover_strength") or 1.0),
    }


# ---------------------------------------------------------------------------
# Áudio: download da origem, conversão e upload
# ---------------------------------------------------------------------------


def _download(url: str, dest_dir: Path) -> str:
    target = dest_dir / "source_audio"
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with open(target, "wb") as fh:
            for chunk in response.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
    return str(target)


def _to_flac_24(wav_path: str, flac_path: Path) -> dict:
    """WAV float32 -> FLAC 24-bit, sem perdas. Devolve duração e taxa."""
    audio, sample_rate = sf.read(wav_path, dtype="float32", always_2d=True)
    sf.write(str(flac_path), audio, sample_rate, format="FLAC", subtype="PCM_24")
    return {
        "duration_ms": int(round(len(audio) / sample_rate * 1000)),
        "sample_rate": int(sample_rate),
        "bit_depth": 24,
    }


def _upload(path: Path, url: str) -> None:
    """
    PUT na URL pré-assinada.

    O Content-Type enviado aqui é o que fica gravado no objeto: medido contra o
    R2, a URL assinada NÃO valida esse cabeçalho, então mandar o tipo errado
    grava o tipo errado em vez de dar erro. Quem finaliza a geração confere.
    """
    last_error: Exception | None = None
    for attempt in range(1, UPLOAD_ATTEMPTS + 1):
        try:
            with open(path, "rb") as fh:
                response = requests.put(
                    url,
                    data=fh,
                    headers={"Content-Type": "audio/flac"},
                    timeout=UPLOAD_TIMEOUT_S,
                )
            if response.status_code < 300:
                return
            last_error = RuntimeError(
                f"upload respondeu {response.status_code}: {response.text[:300]}"
            )
            # 4xx de URL pré-assinada (expirada, assinatura errada) não melhora com retry.
            if 400 <= response.status_code < 500:
                break
        except requests.RequestException as err:
            last_error = err
        time.sleep(2 * attempt)
    raise RuntimeError(f"falha ao subir o áudio no R2: {last_error}")


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

    workdir = Path(tempfile.mkdtemp(prefix="sonora-"))
    timings: dict[str, float] = {}
    try:
        src_audio = None
        if req["src_audio_url"]:
            t = time.time()
            src_audio = _download(req["src_audio_url"], workdir)
            timings["download_s"] = round(time.time() - t, 1)

        audio_codes = ""
        # O servidor oficial converte o áudio em códigos antes de um cover;
        # sem isso o cover perde a estrutura da música de origem.
        if req["task_type"] == "cover" and src_audio:
            codes = DIT.convert_src_audio_to_codes(src_audio)
            if codes and not str(codes).startswith("❌"):
                audio_codes = codes

        uses_lm = req["task_type"] not in AUDIO_TASKS
        params = GenerationParams(
            task_type=req["task_type"],
            instruction=TASK_INSTRUCTIONS.get(req["task_type"], TASK_INSTRUCTIONS["text2music"]),
            src_audio=src_audio,
            audio_codes=audio_codes,
            caption=req["caption"],
            lyrics=req["lyrics"],
            instrumental=req["instrumental"],
            vocal_language=req["vocal_language"],
            bpm=req["bpm"],
            keyscale=req["keyscale"],
            duration=req["duration"] if req["duration"] is not None else -1.0,
            inference_steps=8,
            infer_method="ode",
            guidance_scale=7.0,
            lm_temperature=0.85,
            lm_cfg_scale=2.0,
            lm_top_p=0.9,
            lm_top_k=0,
            # Obrigatório: sem thinking, sem esqueleto rítmico.
            thinking=uses_lm,
            use_cot_metas=uses_lm,
            use_cot_caption=uses_lm,
            use_cot_language=uses_lm,
            use_constrained_decoding=True,
            timesteps=TURBO_TIMESTEPS,
            repainting_start=req["repainting_start"],
            repainting_end=req["repainting_end"],
            audio_cover_strength=req["audio_cover_strength"],
        )
        config = GenerationConfig(
            batch_size=req["batch_size"],
            allow_lm_batch=req["batch_size"] > 1,
            use_random_seed=req["seed"] is None,
            seeds=None if req["seed"] is None else [req["seed"] + i for i in range(req["batch_size"])],
            audio_format="wav32",
        )

        t = time.time()
        result = generate_music(
            dit_handler=DIT,
            llm_handler=LLM,
            params=params,
            config=config,
            save_dir=str(workdir),
        )
        timings["generate_s"] = round(time.time() - t, 1)

        if not result.success:
            return {"error": f"geração falhou: {result.error or result.status_message}"}
        audios = [a for a in (result.audios or []) if a.get("path")]
        if len(audios) < req["batch_size"]:
            return {"error": f"esperava {req['batch_size']} variações, o modelo devolveu {len(audios)}"}

        t = time.time()
        tracks = []
        for index, (audio, upload) in enumerate(zip(audios, req["uploads"])):
            flac_path = workdir / f"track-{index}.flac"
            info = _to_flac_24(audio["path"], flac_path)
            _upload(flac_path, upload["url"])
            track_seed = (audio.get("params") or {}).get("seed")
            tracks.append(
                {
                    "storage_key": upload["storage_key"],
                    "size_bytes": flac_path.stat().st_size,
                    "format": "flac",
                    "seed": track_seed,
                    **info,
                }
            )
        timings["encode_upload_s"] = round(time.time() - t, 1)

        extra = result.extra_outputs or {}
        lm_meta = extra.get("lm_metadata") or {}
        metadata = {
            key: lm_meta.get(key)
            for key in ("caption", "bpm", "duration", "keyscale", "timesignature", "language")
            if lm_meta.get(key) is not None
        }

        return {
            "tracks": tracks,
            "metadata": metadata,
            "timings": timings,
            "worker": {**WORKER_INFO, "cold_start": cold_start},
        }

    except torch.cuda.OutOfMemoryError:
        # Memória da GPU fragmentada: pede à RunPod um worker novo.
        return {"error": "GPU sem memória", "refresh_worker": True}
    except Exception as err:  # noqa: BLE001 — o job precisa sempre devolver um erro legível
        traceback.print_exc()
        return {"error": f"{type(err).__name__}: {err}"}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
