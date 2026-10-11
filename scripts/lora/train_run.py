"""Roda DENTRO do pod de treino: rotula o dataset e treina o LoKr pela API do ACE-Step.

Tudo pela API HTTP que já vem na imagem fixada do worker (acestep.api_server, na
porta 8001): scan -> rotulagem (caption, BPM, tom e, sem .lyrics.txt, a letra
transcrita) -> pré-processamento -> treino LoKr. Nada de credencial do R2 aqui:
entrada e saída são URLs assinadas que vêm em /tmp/job/job.json.

Linha do tempo em /tmp/logs/timeline.txt (o orquestrador local lê por HTTP).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.request

JOB = json.load(open("/tmp/job/job.json", encoding="utf-8"))
WORK = "/app/lora-work"  # dentro do cwd do servidor: o ACE-Step só aceita caminhos sob ele
AUDIO_DIR = f"{WORK}/audio"
TENSOR_DIR = f"{WORK}/tensors"
OUT_DIR = f"{WORK}/out"
DATASET_JSON = f"{AUDIO_DIR}/dataset.json"
API = "http://127.0.0.1:8001"
TIMELINE = "/tmp/logs/timeline.txt"


def mark(event: str, detail: str = "") -> None:
    line = f"{event} {int(time.time())} {detail}".rstrip()
    print(line, flush=True)
    with open(TIMELINE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def http(method: str, path: str, body: dict | None = None, timeout: float = 60) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        payload = json.loads(res.read() or b"{}")
    if isinstance(payload, dict) and payload.get("code", 200) >= 400:
        raise RuntimeError(f"{path}: {payload.get('error')}")
    return payload.get("data", payload) if isinstance(payload, dict) else payload


def download(url: str, dest: str) -> None:
    with urllib.request.urlopen(url, timeout=600) as res, open(dest, "wb") as f:
        while chunk := res.read(1 << 20):
            f.write(chunk)


def upload(url: str, path: str, content_type: str) -> None:
    with open(path, "rb") as f:
        req = urllib.request.Request(url, data=f.read(), method="PUT", headers={"Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=600) as res:
        if res.status >= 300:
            raise RuntimeError(f"upload falhou ({res.status})")


def wait_task(path: str, label: str, max_s: float) -> dict:
    start = time.time()
    last = ""
    while time.time() - start < max_s:
        st = http("GET", path)
        progress = f"{st.get('current')}/{st.get('total')} {st.get('progress', '')}"[:200]
        if progress != last:
            mark(f"{label}_PROGRESS", progress)
            last = progress
        if st.get("status") == "completed":
            return st
        if st.get("status") == "failed":
            raise RuntimeError(f"{label} falhou: {st.get('error')}")
        time.sleep(10)
    raise RuntimeError(f"{label} passou de {max_s:.0f}s")


def wait_server(max_s: float = 1800) -> None:
    start = time.time()
    while time.time() - start < max_s:
        try:
            http("GET", "/health", timeout=10)
            return
        except Exception:
            time.sleep(10)
    raise RuntimeError("servidor do ACE-Step não subiu")


def llm_loaded() -> bool:
    return bool(http("GET", "/health", timeout=30).get("llm_initialized"))


def wait_restore(had_llm: bool, max_s: float = 600) -> None:
    """Espera o servidor devolver decoder e LM à GPU depois do pré-processamento.

    A rota preprocess_async marca a tarefa como "completed" ANTES de restaurar os
    componentes (o restore roda no finally da thread). Chamar start_lokr nessa janela
    disputa a GPU com a recarga do LM: já derrubou o servidor ("Remote end closed
    connection") e já deixou o LM carregado durante o treino (CUDA OOM em 24 GB).
    """
    if not had_llm:
        time.sleep(20)  # sem LM, o restore só devolve o decoder à GPU; não há sinal para esperar
        return
    start = time.time()
    while time.time() - start < max_s:
        if llm_loaded():
            time.sleep(5)
            return
        time.sleep(5)
    raise RuntimeError(f"o servidor não restaurou o LM em {max_s:.0f}s depois do pré-processamento")


def vram_used_mib() -> int:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=20,
        ).stdout
        return int(out.strip().splitlines()[0])
    except Exception:
        return 0


def upload_checkpoints(uploaded: set[int]) -> None:
    """Envia cada checkpoint assim que fica pronto: pod que cai ou bate no teto não perde o treino."""
    root = f"{OUT_DIR}/checkpoints"
    if not os.path.isdir(root):
        return
    for name in sorted(os.listdir(root)):
        match = re.match(r"epoch_(\d+)_", name)
        if not match or int(match.group(1)) in uploaded:
            continue
        epoch = int(match.group(1))
        url = JOB.get("checkpointPutUrls", {}).get(str(epoch))
        # training_state.pt é gravado por último: só então o safetensors está completo.
        if not url or not os.path.exists(f"{root}/{name}/training_state.pt"):
            continue
        upload(url, f"{root}/{name}/lokr_weights.safetensors", "application/octet-stream")
        uploaded.add(epoch)
        mark("CHECKPOINT_UPLOADED", f"{epoch} {name}")


def main() -> None:
    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(TENSOR_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    for item in JOB["inputs"]:
        download(item["url"], f"{AUDIO_DIR}/{item['name']}")
    mark("DOWNLOADED", str(len(JOB["inputs"])))

    wait_server()
    mark("SERVER_UP")

    if JOB.get("reviewedDatasetUrl"):
        # Rótulos já prontos (revisados ou de um --so-rotular): nada de rotular de novo.
        download(JOB["reviewedDatasetUrl"], DATASET_JSON)
        http("POST", "/v1/dataset/load", {"dataset_path": DATASET_JSON})
        mark("DATASET_LOADED", "rótulos prontos (revisados ou do --so-rotular)")
    else:
        scan = http(
            "POST",
            "/v1/dataset/scan",
            {"audio_dir": AUDIO_DIR, "dataset_name": JOB["style"], "all_instrumental": False,
             "custom_tag": JOB.get("customTag", ""), "tag_position": "prepend"},
        )
        mark("SCANNED", str(scan.get("num_samples")))
        task = http(
            "POST",
            "/v1/dataset/auto_label_async",
            {"transcribe_lyrics": JOB["transcribeLyrics"], "save_path": DATASET_JSON},
        )
        wait_task(f"/v1/dataset/auto_label_status/{task['task_id']}", "LABEL", 3600)
        http("POST", "/v1/dataset/save", {"save_path": DATASET_JSON, "dataset_name": JOB["style"]})
        mark("LABELED")

    upload(JOB["labelsPutUrl"], DATASET_JSON, "application/json")
    mark("LABELS_UPLOADED")
    if JOB.get("labelOnly"):
        mark("ALL_DONE", "só rotulagem")
        return

    had_llm = llm_loaded()
    task = http("POST", "/v1/dataset/preprocess_async", {"output_dir": TENSOR_DIR})
    wait_task(f"/v1/dataset/preprocess_status/{task['task_id']}", "PREPROCESS", 3600)
    mark("PREPROCESSED")
    wait_restore(had_llm)
    mark("RESTORED", f"lm={'sim' if had_llm else 'não'}")

    http("POST", "/v1/training/start_lokr", {"tensor_dir": TENSOR_DIR, "output_dir": OUT_DIR, **JOB["lokr"]})
    mark("TRAINING_STARTED", json.dumps(JOB["lokr"]))
    start = time.time()
    last_epoch = -1
    peak_vram = 0
    total_epochs = JOB["lokr"]["train_epochs"]
    first_epoch: tuple[int, float] | None = None  # (época, instante) da 1ª virada de época vista
    eta_marked = False
    uploaded: set[int] = set()
    while True:
        st = http("GET", "/v1/training/status")
        peak_vram = max(peak_vram, vram_used_mib())
        if st.get("current_epoch") != last_epoch:
            last_epoch = st.get("current_epoch")
            mark("EPOCH", f"{last_epoch} loss={st.get('current_loss')} vram_pico={peak_vram}MiB")
            if last_epoch and first_epoch is None:
                first_epoch = (last_epoch, time.time())
            elif first_epoch and not eta_marked and last_epoch >= first_epoch[0] + 3:
                # Projeção cedo: melhor saber em 5 min que o teto não alcança do que em 2 h.
                per_epoch = (time.time() - first_epoch[1]) / (last_epoch - first_epoch[0])
                mark("ETA", f"{per_epoch:.0f}s/época; {total_epochs} épocas levam ~{per_epoch * total_epochs / 3600:.1f} h; "
                            f"o teto de {JOB['maxTrainS'] // 60} min alcança ~{int(JOB['maxTrainS'] / per_epoch)} épocas")
                eta_marked = True
        upload_checkpoints(uploaded)
        if st.get("error"):
            raise RuntimeError(f"treino falhou: {st['error']}")
        if not st.get("is_training") and time.time() - start > 30:
            break
        if time.time() - start > JOB["maxTrainS"]:
            http("POST", "/v1/training/stop", {})
            upload_checkpoints(uploaded)
            if not uploaded:
                raise RuntimeError(f"treino passou do teto de tempo na época {last_epoch}, antes do 1º checkpoint")
            # O stop não grava o "final": o que fica é o último checkpoint, já no bucket.
            mark("PARTIAL", f"teto de tempo na época {last_epoch} de {total_epochs}; último checkpoint enviado: época {max(uploaded)}")
            mark("ALL_DONE", "parcial")
            return
        time.sleep(15)
    upload_checkpoints(uploaded)

    weights = f"{OUT_DIR}/final/lokr_weights.safetensors"
    if not os.path.exists(weights):
        raise RuntimeError(f"treino terminou sem {weights}: {st.get('status')}")
    upload(JOB["weightsPutUrl"], weights, "application/octet-stream")
    mark("WEIGHTS_UPLOADED", str(os.path.getsize(weights)))
    mark("ALL_DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # o orquestrador lê o motivo na linha do tempo
        mark("FAILED", str(exc)[:500])
        sys.exit(1)
