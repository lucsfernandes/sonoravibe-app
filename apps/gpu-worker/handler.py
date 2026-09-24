"""
Worker serverless da RunPod que gera música com o ACE-Step 1.5.

Contrato (entrada em job["input"]):
    caption          str, obrigatório   estilo/descrição (até 512 caracteres)
    negative_caption str | None         estilos a EVITAR (até 512 caracteres), sem "no"/"without":
                                        vai para o lm_negative_prompt, não para o caption
    lyrics           str                letra com marcadores [Verse]/[Chorus]; vazio = sem letra
    instrumental     bool               força instrumental
    duration         float | None       10–480 s; None = o modelo decide pelo tamanho da letra
    bpm              int | None         30–300; None = automático
    keyscale         str | None         ex. "C Major", "Am"; None = automático
    vocal_language   str                código do idioma ("pt", "en"...); padrão "unknown"
    seed             int | None         reprodutibilidade (só vale no mesmo tipo de GPU)
    style_influence  int                0–100, padrão 50: quanto seguir o estilo. SÓ age no perfil
                                        SFT (vira o CFG); o turbo, que é o padrão, não tem CFG
    variety          str                "low" | "medium" | "high" (padrão): temperatura do LM.
                                        Também só age no perfil SFT
    batch_size       int                1 ou 2 variações por pedido (2 só em text2music)
    model_family     str | None         "turbo" | "sft": a família que o pedido espera. Se o
                                        endpoint carregou a outra, o pedido é recusado
    inference_steps  int | None         passos de difusão, só no SFT (8–100); None = ACESTEP_SFT_STEPS
    cot_caption      bool | None        o LM reescreve o caption? None = ACESTEP_COT_CAPTION
    task_type        str                "text2music" | "cover" | "repaint"
    src_audio_url    str                obrigatório para cover/repaint
    repainting_start float              repaint: início do trecho, em segundos
    repainting_end   float              repaint: fim do trecho (-1 = até o fim)
    audio_cover_strength float          cover: 0–1
    uploads          list[{url, storage_key}]  um destino pré-assinado no R2 por variação

Saída:
    {"tracks": [{storage_key, size_bytes, duration_ms, format, sample_rate, bit_depth, seed}],
     "metadata": {...}, "timings": {...}, "worker": {...}}

Decisões — as de ritmo e cold start vêm de medições em docs/ARQUITETURA.md; a escolha
do modelo, do benchmark com escuta em docs/BENCHMARK-QUALIDADE.md:
  - Cada endpoint carrega UMA família de DiT (ACESTEP_CONFIG_PATH): o XL-turbo
    (v1 e v1.5 do produto) ou o XL-SFT (v2.0 e v2.5). O que muda entre as versões
    da mesma família — passos e reescrita do caption — vem no pedido; o mapa
    versão → parâmetros vive em packages/shared/src/models.ts. Todas as versões
    foram escolhidas por escuta (docs/BENCHMARK-MIDNIGHT.md); as métricas
    apontaram o vencedor errado duas vezes. Não trocar sem escutar de novo.
  - O SFT NÃO é o turbo: precisa de ~50 passos de difusão com CFG e SEM DCW,
    enquanto o turbo é destilado para 8 passos sem CFG e COM DCW. Por isso os
    parâmetros de difusão saem de um perfil por família (`_model_settings`).
    Misturar os dois não dá erro nenhum: dá ruído ou áudio "quebrado".
  - O que evitar (exclude styles) vai em `lm_negative_prompt`, nunca no caption.
    O DiT não tem negativo próprio (o CFG dele usa um caption nulo); o único
    negativo real do ACE-Step é o do LM, o ramo incondicional do guidance dele,
    que afasta os códigos semânticos do estilo excluído. Citar o estilo no
    caption ("without X") faz o inverso: o encoder de texto embute o X.
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

import numpy as np
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
CONFIG_PATH = os.environ.get("ACESTEP_CONFIG_PATH", "acestep-v15-xl-turbo")
LM_MODEL_PATH = os.environ.get("ACESTEP_LM_MODEL_PATH", "acestep-5Hz-lm-1.7B")
LM_BACKEND = os.environ.get("ACESTEP_LM_BACKEND", "vllm")

# O perfil de difusão depende da família do DiT: o turbo é destilado, o SFT não.
IS_TURBO = "turbo" in CONFIG_PATH.lower()


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# O padrão (XL-turbo + LM 1.7B) roda sem offload numa GPU de 24 GB. O offload
# tira o encoder e o VAE da GPU entre as etapas e desliga a checagem prévia de VRAM
# do ACE-Step, que recusa faixas longas por estimativa (ver docs/BENCHMARK-QUALIDADE.md).
# Na RTX 4060 (8 GB) do teste local, é obrigatório.
OFFLOAD_TO_CPU = _env_bool("ACESTEP_OFFLOAD_TO_CPU", False)
OFFLOAD_DIT_TO_CPU = _env_bool("ACESTEP_OFFLOAD_DIT_TO_CPU", False)
LM_OFFLOAD_TO_CPU = _env_bool("ACESTEP_LM_OFFLOAD_TO_CPU", False)

# O LM reescreve o caption e é a versão dele que o DiT recebe. Enriquece um
# caption curto, mas se afasta do estilo pedido (medido: 10 de 10 captions do
# benchmark trouxeram itens da lista de exclusão; ver docs/BENCHMARK-QUALIDADE.md).
# Fica LIGADO porque é assim que a configuração escolhida foi escutada: o XL-turbo
# soou limpo com a reescrita ligada. Desligar devolve ao DiT o caption do usuário,
# palavra por palavra — só foi testado com o XL-SFT, não com o XL-turbo, e o ritmo
# foi medido com ela ligada. Escute antes de mudar o padrão.
COT_CAPTION = _env_bool("ACESTEP_COT_CAPTION", True)

MIN_DURATION = 10.0
# Teto com o LM ligado, segundo o gpu_config do ACE-Step. Os 10 min anunciados
# exigem o LM desligado — e sem LM volta o descompasso.
MAX_DURATION = 480.0
MAX_CAPTION = 512
MAX_LYRICS = 4096
# Faixas por chamada. O ACE-Step gera o lote inteiro junto (LM em lote, DiT em
# lote), o que sai bem mais barato que duas chamadas.
MAX_BATCH = 2

# --- Perfil do turbo ---------------------------------------------------------
# Cronograma de difusão do turbo usado pelo servidor oficial — é a configuração
# em que medimos o ritmo corrigido. Não trocar sem medir de novo.
TURBO_TIMESTEPS = [0.97, 0.76, 0.615, 0.5, 0.395, 0.28, 0.18, 0.085, 0.0]

# --- Perfil do SFT (XL-SFT) --------------------------------------------------
# Os defaults da própria UI do ACE-Step para modelos SFT: 50 passos e shift 3.0
# (a docs de inferência recomenda 30–100 passos e CFG entre 5 e 9). O número de
# passos é o botão de custo x qualidade e pode ser mudado por env, sem rebuild.
SFT_STEPS = int(os.environ.get("ACESTEP_SFT_STEPS", "50"))
SFT_SHIFT = 3.0
# "Aderência ao estilo" da UI (0–100) -> guidance_scale (CFG) do DiT. 50 dá 7.0,
# o padrão do ACE-Step; as pontas ficam dentro da faixa 5–9 recomendada: acima
# disso o CFG passa a saturar o áudio, que é justamente o ruído que se quer evitar.
CFG_MIN, CFG_MAX = 5.0, 9.0
LM_CFG_SCALE = 2.5  # >1 é o que faz o lm_negative_prompt valer

# "Variedade" da UI -> temperatura do LM. O teto é 0.85, a temperatura em que o
# ritmo foi medido; abaixo dela o modelo segue o caption com mais fidelidade.
LM_TEMPERATURE_BY_VARIETY = {"low": 0.7, "medium": 0.8, "high": 0.85}
DEFAULT_VARIETY = "high"

# Medido no benchmark (nvidia-smi, 2 faixas): XL-SFT + LM 4B chega a 26,1 GB de
# VRAM; XL + LM 1.7B, a 18–21 GB. Com o LM 4B não cabe numa GPU de 24 GB.
XL_4B_MIN_VRAM_GB = 32.0

# --- Fim da faixa (ver _finish_ending) ------------------------------------------
# Só em text2music: cover e repaint devolvem a estrutura da faixa de origem, e
# cortar o fim dela mudaria o que o usuário mandou preservar.
TRIM_TAIL = _env_bool("ACESTEP_TRIM_TAIL", True)
FADE_OUT_S = float(os.environ.get("ACESTEP_FADE_OUT_S", "1.5"))
TAIL_SILENCE_DB = -50.0  # abaixo disso (RMS em 50 ms) é silêncio; o corpo das faixas fica em -16 a -20
TAIL_WINDOW_S = 0.05
TAIL_KEEP_S = 0.3  # respiro depois do último som, para o corte não soar seco
TAIL_MIN_TRIM_S = 0.5  # menos que isso de silêncio não vale mexer

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
        "profile": "turbo" if IS_TURBO else f"sft-{SFT_STEPS}steps",
        "cot_caption": COT_CAPTION,
        "load_s": round(time.time() - started, 1),
    }
    if torch.cuda.is_available():
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        info["vram_total_gb"] = round(total_bytes / 1024**3, 1)
        # O que sobra depois da carga é o que resta às ativações de cada faixa.
        info["vram_free_after_load_gb"] = round(free_bytes / 1024**3, 1)
        if (
            not IS_TURBO
            and "xl" in CONFIG_PATH.lower()
            and "4B" in LM_MODEL_PATH
            and total_bytes / 1024**3 < XL_4B_MIN_VRAM_GB
        ):
            print(
                f"[sonora] AVISO: {CONFIG_PATH} + {LM_MODEL_PATH} numa GPU de "
                f"{info['vram_total_gb']} GB (estimativa: pede ~{XL_4B_MIN_VRAM_GB:.0f} GB). "
                f"Faixas longas podem falhar por falta de memória; use uma GPU de 48 GB "
                f"ou volte o LM para 1.7B (ACESTEP_LM_MODEL_PATH).",
                flush=True,
            )
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

    negative_caption = (data.get("negative_caption") or "").strip()
    if len(negative_caption) > MAX_CAPTION:
        raise InputError(f"'negative_caption' passa de {MAX_CAPTION} caracteres")

    batch_size = int(data.get("batch_size") or 1)
    if not 1 <= batch_size <= MAX_BATCH:
        raise InputError(f"'batch_size' precisa estar entre 1 e {MAX_BATCH}")
    # Cover e repaint partem de UM áudio de origem: o lote não foi exercitado ali.
    if batch_size > 1 and task_type != "text2music":
        raise InputError(f"'{task_type}' aceita só batch_size 1")

    # Um pedido de v2 (SFT) no endpoint turbo, ou o contrário, geraria com o modelo
    # errado sem erro nenhum. Melhor recusar: é configuração, não acaso.
    model_family = data.get("model_family")
    if model_family is not None and model_family not in ("turbo", "sft"):
        raise InputError(f"'model_family' desconhecida: {model_family}")
    loaded_family = "turbo" if IS_TURBO else "sft"
    if model_family is not None and model_family != loaded_family:
        raise InputError(
            f"pedido para a família '{model_family}', mas este endpoint carregou '{CONFIG_PATH}'"
        )

    inference_steps = _optional_number(data, "inference_steps", 8, 100, as_int=True)
    if inference_steps is not None and IS_TURBO and inference_steps != 8:
        raise InputError("o turbo é destilado para 8 passos; 'inference_steps' não se aplica")

    cot_caption = data.get("cot_caption")
    if cot_caption is not None and not isinstance(cot_caption, bool):
        raise InputError("'cot_caption' precisa ser booleano")

    style_influence = _optional_number(data, "style_influence", 0, 100, as_int=True)
    variety = (data.get("variety") or DEFAULT_VARIETY).strip().lower()
    if variety not in LM_TEMPERATURE_BY_VARIETY:
        raise InputError(f"'variety' precisa ser um de {sorted(LM_TEMPERATURE_BY_VARIETY)}")

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
        "negative_caption": negative_caption,
        "style_influence": 50 if style_influence is None else style_influence,
        "variety": variety,
        "inference_steps": inference_steps,
        "cot_caption": COT_CAPTION if cot_caption is None else cot_caption,
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
# Perfil do modelo: como o pedido vira parâmetros de difusão e do LM
# ---------------------------------------------------------------------------


def _model_settings(req: dict) -> dict[str, Any]:
    """
    Parâmetros de difusão e de LM que dependem do modelo carregado e dos
    controles de 0–100 da UI. Função pura, para testar sem GPU.

    Turbo: 8 passos com o cronograma fixo de sempre, sem CFG — a configuração
    em que o ritmo foi medido; os controles da UI não mexem no DiT.
    SFT: 50 passos (env), shift 3.0 e CFG guiado por `style_influence`.
    """
    negative = req.get("negative_caption") or ""
    # "NO USER INPUT" é o sentinela do ACE-Step para "sem negativo": o CFG do LM
    # então usa um caption vazio como ramo incondicional.
    lm_negative_prompt = negative if negative else "NO USER INPUT"

    if IS_TURBO:
        return {
            "inference_steps": 8,
            "guidance_scale": 7.0,  # o pipeline força 1.0 no turbo; fica por clareza
            "infer_method": "ode",
            "timesteps": TURBO_TIMESTEPS,
            # DCW é a correção feita para o turbo; é assim que o XL-turbo foi escutado.
            "dcw_enabled": True,
            "lm_temperature": 0.85,
            "lm_cfg_scale": 2.0,
            "lm_negative_prompt": lm_negative_prompt,
        }

    influence = max(0, min(100, int(req.get("style_influence", 50))))
    return {
        "inference_steps": req.get("inference_steps") or SFT_STEPS,
        "guidance_scale": round(CFG_MIN + (CFG_MAX - CFG_MIN) * influence / 100, 2),
        "shift": SFT_SHIFT,
        "infer_method": "ode",
        # `timesteps` sobrepõe passos e shift; o do turbo NUNCA pode vir para o SFT.
        "timesteps": None,
        # DCW DESLIGADO fora do turbo. Na imagem fixada (dce6214) ele vem ligado para
        # qualquer modelo, e num modelo sem destilação distorce o áudio (issue #1259 do
        # ACE-Step, corrigida depois com um padrão por modelo). Foi o que deixou todas as
        # faixas XL-SFT dos primeiros benchmarks "quebradas".
        "dcw_enabled": False,
        "lm_temperature": LM_TEMPERATURE_BY_VARIETY[req.get("variety", DEFAULT_VARIETY)],
        "lm_cfg_scale": LM_CFG_SCALE,
        "lm_negative_prompt": lm_negative_prompt,
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


def _finish_ending(audio: "np.ndarray", sample_rate: int) -> tuple["np.ndarray", dict]:
    """
    Arruma o fim da faixa: corta o silêncio final e aplica um fade curto.

    O ACE-Step gera a duração pedida, mas quem decide onde a música acaba é o
    plano do LM. Medido no benchmark "Midnight retrowave" (120 s pedidos): várias
    faixas acabaram entre 1:35 e 1:52 e o resto era silêncio; outras pararam de
    uma vez, de volume cheio a nada em menos de 1 s. O ouvinte percebe as duas
    coisas como defeito. O corte entrega a música do tamanho que ela tem; o fade
    transforma a parada seca em final.

    Uma faixa que já termina em fade (a maioria das boas) passa quase intacta: o
    silêncio a cortar é menor que o mínimo, e o fade só suaviza o que já descia.
    """
    info = {"trimmed_ms": 0, "fade_ms": 0}
    if len(audio) == 0:
        return audio, info

    window = max(1, int(sample_rate * TAIL_WINDOW_S))
    mono = audio.mean(axis=1)
    n_windows = len(mono) // window
    if n_windows == 0:
        return audio, info
    frames = mono[: n_windows * window].reshape(n_windows, window)
    rms_db = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-9)
    loud = np.nonzero(rms_db > TAIL_SILENCE_DB)[0]
    if len(loud) == 0:
        return audio, info  # faixa inteira em silêncio: não é caso para mexer no fim

    if TRIM_TAIL:
        end = min(len(audio), (int(loud[-1]) + 1) * window + int(sample_rate * TAIL_KEEP_S))
        if len(audio) - end >= int(sample_rate * TAIL_MIN_TRIM_S):
            info["trimmed_ms"] = int(round((len(audio) - end) / sample_rate * 1000))
            audio = audio[:end]

    fade = min(int(sample_rate * FADE_OUT_S), len(audio) // 4)
    if fade > 0:
        # Meio cosseno: cai devagar no começo e some sem degrau no fim.
        ramp = (0.5 * (1 + np.cos(np.linspace(0, np.pi, fade)))).astype(audio.dtype)
        audio = audio.copy()
        audio[-fade:] *= ramp[:, None]
        info["fade_ms"] = int(round(fade / sample_rate * 1000))
    return audio, info


def _to_flac_24(wav_path: str, flac_path: Path, finish_ending: bool = False) -> dict:
    """WAV float32 -> FLAC 24-bit, sem perdas. Devolve duração e taxa."""
    audio, sample_rate = sf.read(wav_path, dtype="float32", always_2d=True)
    ending = {"trimmed_ms": 0, "fade_ms": 0}
    if finish_ending:
        audio, ending = _finish_ending(audio, sample_rate)
    sf.write(str(flac_path), audio, sample_rate, format="FLAC", subtype="PCM_24")
    return {
        "duration_ms": int(round(len(audio) / sample_rate * 1000)),
        "sample_rate": int(sample_rate),
        "bit_depth": 24,
        **ending,
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
        settings = _model_settings(req)
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
            lm_top_p=0.9,
            lm_top_k=0,
            # Obrigatório: sem thinking, sem esqueleto rítmico.
            thinking=uses_lm,
            use_cot_metas=uses_lm,
            use_cot_caption=uses_lm and req["cot_caption"],
            use_cot_language=uses_lm,
            use_constrained_decoding=True,
            # Difusão e LM conforme o modelo carregado (turbo x SFT).
            **settings,
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
            info = _to_flac_24(audio["path"], flac_path, finish_ending=req["task_type"] == "text2music")
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
        # O que de fato rodou, para diagnosticar qualidade sem abrir o log do worker.
        metadata["settings"] = {
            key: settings[key]
            for key in ("inference_steps", "guidance_scale", "lm_temperature", "lm_cfg_scale", "dcw_enabled")
        }
        metadata["settings"]["cot_caption"] = req["cot_caption"]
        metadata["negative_applied"] = settings["lm_negative_prompt"] != "NO USER INPUT"

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
