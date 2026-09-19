"""
Mede a regularidade rítmica de faixas geradas.

Complementa a escuta humana com números comparáveis entre variações de geração
(thinking on/off, duração forçada/automática, turbo/SFT). Não mede se cada
instrumento está alinhado com os outros — mede o quão estável é o pulso da
mixagem inteira, que é onde o "descompasso" costuma aparecer.

Métricas:
  tempo_bpm      tempo global estimado
  ibi_cv_pct     variação dos intervalos entre batidas (desvio / média). Menor = mais estável.
  ibi_fora_pct   % de intervalos que desviam mais de 10% da mediana. Menor = melhor.
  deriva_bpm     desvio do tempo local entre janelas de 15s. Menor = sem acelerar/frear.
  clareza_pulso  força média do pulso predominante (PLP), 0-1. Maior = batida mais nítida.

Uso (ambiente isolado, sem tocar no ambiente do ACE-Step):
  python -m uv run --no-project --with librosa python scripts/analyze-rhythm.py <arquivos...>
"""

import subprocess
import sys
import tempfile
from pathlib import Path

import librosa
import numpy as np

SR = 22050


def decode(path: Path) -> np.ndarray:
    """Decodifica via FFmpeg para WAV mono: evita depender de codec de MP3 no Python."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "a.wav"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(path), "-ac", "1", "-ar", str(SR), str(wav)],
            check=True,
        )
        audio, _ = librosa.load(wav, sr=SR, mono=True)
    return audio


def analyze(path: Path) -> dict:
    y = decode(path)
    onset_env = librosa.onset.onset_strength(y=y, sr=SR)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR)
    beat_times = librosa.frames_to_time(beats, sr=SR)
    ibi = np.diff(beat_times)

    median_ibi = float(np.median(ibi)) if len(ibi) else float("nan")
    ibi_cv = float(np.std(ibi) / np.mean(ibi) * 100) if len(ibi) else float("nan")
    off = float(np.mean(np.abs(ibi - median_ibi) > 0.10 * median_ibi) * 100) if len(ibi) else float("nan")

    # Tempo local por janela de 15s: detecta aceleração/frenagem ao longo da música.
    window = 15 * SR
    local = []
    for start in range(0, len(y) - window, window):
        seg_env = librosa.onset.onset_strength(y=y[start : start + window], sr=SR)
        t, _ = librosa.beat.beat_track(onset_envelope=seg_env, sr=SR)
        t = float(np.atleast_1d(t)[0])
        if t > 0:
            local.append(t)
    local = np.array(local)
    # Janelas que dobram/dividem o tempo são erro de oitava do estimador, não do áudio.
    if len(local):
        ref = float(np.median(local))
        folded = np.array([t * 2 if t < ref * 0.7 else t / 2 if t > ref * 1.4 else t for t in local])
        drift = float(np.std(folded))
    else:
        drift = float("nan")

    pulse = librosa.beat.plp(onset_envelope=onset_env, sr=SR)
    clarity = float(np.mean(pulse))

    return {
        "arquivo": path.name,
        "duracao_s": round(len(y) / SR, 1),
        "tempo_bpm": round(float(np.atleast_1d(tempo)[0]), 1),
        "ibi_cv_pct": round(ibi_cv, 2),
        "ibi_fora_pct": round(off, 1),
        "deriva_bpm": round(drift, 2),
        "clareza_pulso": round(clarity, 3),
    }


def main() -> None:
    files = [Path(p) for p in sys.argv[1:]]
    if not files:
        print(__doc__)
        sys.exit(1)

    rows = [analyze(f) for f in files]
    cols = ["arquivo", "duracao_s", "tempo_bpm", "ibi_cv_pct", "ibi_fora_pct", "deriva_bpm", "clareza_pulso"]
    widths = {c: max(len(c), *(len(str(r[c])) for r in rows)) for c in cols}
    print("  ".join(c.ljust(widths[c]) for c in cols))
    for r in rows:
        print("  ".join(str(r[c]).ljust(widths[c]) for c in cols))


if __name__ == "__main__":
    main()
