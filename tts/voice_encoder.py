#!/usr/bin/env python3
"""Encode a reference recording into a HolosTTS voice vector.

The vector is 256 float32 values (128 acoustic + 128 prosodic). The same
vector works with the PyTorch, ONNX and MLX runtimes, so it only has to be
computed once, when the voice is created.

    python voice_encoder.py reference.wav voice.npy

This needs torch, torchaudio and librosa; the web app runs it in the first
Python it finds that has them (.venv-voice, then .venv-omni, then itself).
The 192 MB encoder checkpoint is downloaded from Hugging Face on first use.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CHECKPOINT_URL = "https://huggingface.co/patriotyk/HolosTTS/resolve/main/voice_encoder.pt"
CHECKPOINT_SHA256 = "81d6134dbfe105131d908333f5132a01c471e80d9070f5f381745eabdd48fe74"
TARGET_SR = 24000
VECTOR_SIZE = 256


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    raise SystemExit(1)


def ensure_checkpoint(path: Path) -> Path:
    if path.is_file():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    print(f"downloading {CHECKPOINT_URL} -> {path}", file=sys.stderr, flush=True)
    try:
        urllib.request.urlretrieve(CHECKPOINT_URL, tmp)
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        fail(f"cannot download voice encoder: {exc}")
    digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
    if digest != CHECKPOINT_SHA256:
        tmp.unlink(missing_ok=True)
        fail(f"voice encoder checksum mismatch: {digest}")
    tmp.replace(path)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path, help="reference recording (wav/flac/ogg)")
    parser.add_argument("out", type=Path, help="output .npy with the 256-value vector")
    parser.add_argument("--device", default=os.getenv("VOICE_ENCODER_DEVICE", "cpu"),
                        help="torch device: cpu or mps (default: cpu)")
    parser.add_argument("--checkpoint",
                        default=os.getenv("VOICE_ENCODER",
                                          str(ROOT / "models" / "holos" / "voice_encoder.pt")))
    parser.add_argument("--max-sec", type=float, default=30.0,
                        help="only the first N seconds are used (default: 30)")
    args = parser.parse_args()

    if not args.audio.is_file():
        fail(f"no such audio file: {args.audio}")
    checkpoint = ensure_checkpoint(Path(args.checkpoint))

    checkout = ROOT / "HolosTTS"
    if checkout.is_dir():
        sys.path.insert(0, str(checkout))
    try:
        import numpy as np
        import soundfile as sf
        import torch
        from holos.models import VoiceEncoder
    except Exception as exc:
        fail(
            f"{type(exc).__name__}: {exc} — this Python needs torch, torchaudio "
            "and librosa (run ./install-voice.sh)"
        )

    try:
        info = sf.info(str(args.audio))
        if info.frames <= 0:
            fail("the recording is empty")
        encoder = VoiceEncoder(str(checkpoint), device=args.device)
        with torch.inference_mode():
            vector = encoder(str(args.audio), max_sec=args.max_sec)
        vector = vector.squeeze(0).detach().cpu().numpy().astype(np.float32).reshape(-1)
        if vector.size != VECTOR_SIZE:
            fail(f"encoder returned {vector.size} values, expected {VECTOR_SIZE}")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        tmp = args.out.with_suffix(args.out.suffix + ".part")
        with open(tmp, "wb") as handle:
            np.save(handle, vector)
        tmp.replace(args.out)
    except SystemExit:
        raise
    except Exception as exc:
        fail(f"{type(exc).__name__}: {exc}")

    raw = np.ascontiguousarray(vector, dtype="<f4").tobytes()
    print(json.dumps({
        "ok": True,
        "path": str(args.out),
        "size": int(vector.size),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "duration": round(info.frames / info.samplerate, 2),
        "input_sr": int(info.samplerate),
        "target_sr": TARGET_SR,
        "device": args.device,
    }))


if __name__ == "__main__":
    main()
