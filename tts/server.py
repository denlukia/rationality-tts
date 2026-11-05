#!/usr/bin/env python3
"""Minimal HolosTTS sidecar for rationality-tts.

The SvelteKit app owns content, hashing, the JSON database and patch logic.
This process only turns one sentence into one compressed audio file.

Engine auto-detection:
  * Apple Silicon + holos-tts-mlx  -> MLX
  * everything else (Windows/Linux) -> ONNX (holos-tts-onnx)
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = Path(os.getenv("AUDIO_DIR", ROOT / "data" / "audio")).resolve()
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

SAMPLE_RATE = 24000
VOICE = os.getenv("HOLOS_VOICE", "Speaker_84")
SPEED = float(os.getenv("HOLOS_SPEED", "1.0"))
BITRATE = os.getenv("HOLOS_BITRATE", "24k")
ENGINE_ENV = os.getenv("HOLOS_ENGINE", "auto").lower()
MLX_MODEL = os.getenv("HOLOS_MLX_MODEL", "patriotyk/HolosTTS/mlx")
ONNX_MODEL = os.getenv("HOLOS_ONNX_MODEL", "patriotyk/HolosTTS/onnx-int8")

app = FastAPI(title="rationality-tts sidecar")
_model = None
_engine: Optional[str] = None
_stressifier = None
_model_lock = threading.Lock()
_synth_lock = threading.Lock()


def detect_engine() -> str:
    if ENGINE_ENV in ("mlx", "onnx"):
        return ENGINE_ENV
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        try:
            import holos_mlx  # noqa: F401

            return "mlx"
        except Exception:
            pass
    try:
        import holos_onnx  # noqa: F401

        return "onnx"
    except Exception as exc:
        raise RuntimeError(
            "No HolosTTS runtime found. Install holos-tts-onnx (all platforms) "
            "or holos-tts-mlx (Apple Silicon)."
        ) from exc


def get_model():
    global _model, _engine
    if _model is None:
        with _model_lock:
            if _model is None:
                engine = detect_engine()
                if engine == "mlx":
                    from holos_mlx import HolosTTS

                    _model = HolosTTS(MLX_MODEL)
                else:
                    from holos_onnx import HolosTTS

                    _model = HolosTTS(ONNX_MODEL)
                _engine = engine
                print(f"[tts] {engine} model loaded", flush=True)
    return _model


def get_stressifier():
    global _stressifier
    if _stressifier is None:
        with _model_lock:
            if _stressifier is None:
                from ukrainian_word_stress import Stressifier

                _stressifier = Stressifier()
                print("[tts] stressifier loaded", flush=True)
    return _stressifier


def phonemize(text: str) -> str:
    from ipa_uk import ipa

    stressed = get_stressifier()(text)
    return ipa(stressed)


def ffmpeg() -> Optional[str]:
    return shutil.which("ffmpeg")


def encode(wav: Path, key: str) -> tuple[str, float]:
    """Encode WAV to compact Opus. Falls back to WAV if ffmpeg is missing."""
    exe = ffmpeg()
    if not exe:
        out = AUDIO_DIR / f"{key}.wav"
        shutil.move(str(wav), str(out))
        return out.name, out.stat().st_size / 32_000.0
    out = AUDIO_DIR / f"{key}.opus"
    subprocess.run(
        [
            exe,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(wav),
            "-c:a",
            "libopus",
            "-b:a",
            BITRATE,
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-application",
            "voip",
            str(out),
        ],
        check=True,
    )
    return out.name, 0.0


def split_long(text: str, limit: int = 280) -> list[str]:
    parts: list[str] = []
    rest = text.strip()
    while len(rest) > limit:
        cut = -1
        for sep in ("; ", ", ", " — ", " "):
            idx = rest.rfind(sep, 0, limit)
            if idx > limit * 0.4:
                cut = idx + len(sep)
                break
        if cut < 0:
            cut = limit
        parts.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        parts.append(rest)
    return parts or [text]


class SynthBody(BaseModel):
    text: str
    key: str
    voice: Optional[str] = None


@app.get("/health")
def health():
    return {
        "engine": _engine or (ENGINE_ENV if ENGINE_ENV != "auto" else detect_engine()),
        "ready": _model is not None,
        "ffmpeg": bool(ffmpeg()),
        "format": "opus" if ffmpeg() else "wav",
    }


@app.post("/synth")
def synth(body: SynthBody):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    if not body.key or not all(c in "0123456789abcdef" for c in body.key):
        raise HTTPException(400, "bad key")

    existing = next((p for p in (AUDIO_DIR / f"{body.key}.opus", AUDIO_DIR / f"{body.key}.wav") if p.exists()), None)
    if existing is not None:
        try:
            info = sf.info(str(existing))
            return {"file": existing.name, "duration": round(info.duration, 3), "engine": _engine, "cached": True}
        except Exception:
            pass

    model = get_model()
    voice = body.voice or VOICE
    sr = int(getattr(model, "sample_rate", SAMPLE_RATE))
    chunks: list[np.ndarray] = []
    total = 0.0
    with _synth_lock:
        for piece in split_long(text):
            audio = model.generate(phonemize(piece), voice=voice, speed=SPEED)
            arr = np.asarray(audio, dtype=np.float32).reshape(-1)
            chunks.append(arr)
            total += len(arr) / sr
        if not chunks:
            raise HTTPException(400, "nothing to synthesize")
        merged = np.concatenate(chunks)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        sf.write(tmp_path, merged, sr, subtype="PCM_16")
        file, _ = encode(tmp_path, body.key)
    finally:
        tmp_path.unlink(missing_ok=True)
    return {
        "file": file,
        "duration": round(total, 3),
        "engine": _engine,
        "cached": False,
        "created": time.time(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("TTS_HOST", "127.0.0.1"), port=int(os.getenv("TTS_PORT", "8767")))
