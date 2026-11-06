#!/usr/bin/env python3
"""Fish Audio Drama 3 worker for rationality-tts.

Runs in its own virtualenv (.venv-drama) because mlx-audio needs a different
dependency set from HolosTTS. The sidecar keeps this process alive between
sentences and kills it to reclaim ~23 GB of unified memory.

Protocol: one JSON object per line on stdin, one JSON response per line on
stdout. While the model loads, library prints are redirected to stderr so they
cannot corrupt the protocol stream.

Request:
  {"id": "...", "cmd": "synth", "text": "...", "out": "/tmp/x.wav",
   "ref_audio": "/path/ref.wav", "ref_text": "transcript"}

Response:
  {"id": "...", "ok": true, "duration": 4.2, "sample_rate": 44100,
   "load": 8.1, "gen": 4.4}
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Keep stdout exclusively for the protocol; everything else goes to stderr.
_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr

import numpy as np
import soundfile as sf


def send(payload: dict) -> None:
    _proto.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _proto.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    model = None
    load_time = 0.0

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        req_id = req.get("id")
        cmd = req.get("cmd", "synth")

        if cmd == "quit":
            break
        if cmd == "ping":
            send({"id": req_id, "ok": True, "loaded": model is not None})
            continue

        try:
            if model is None:
                from mlx_audio.tts.utils import load_model

                started = time.time()
                model = load_model(args.model)
                load_time = time.time() - started
                print(f"[drama] loaded in {load_time:.1f}s", flush=True)

            text = (req.get("text") or "").strip()
            if not text:
                raise ValueError("empty text")
            out = Path(req["out"])

            kwargs = {}
            ref_audio = req.get("ref_audio")
            if ref_audio:
                kwargs["ref_audio"] = ref_audio
                kwargs["ref_text"] = req.get("ref_text") or ""

            started = time.time()
            chunks = [
                np.asarray(result.audio, dtype=np.float32).reshape(-1)
                for result in model.generate(text=text, **kwargs)
            ]
            gen_time = time.time() - started

            audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
            sample_rate = int(model.sample_rate)
            out.parent.mkdir(parents=True, exist_ok=True)
            sf.write(out, audio, sample_rate, subtype="PCM_16")

            send(
                {
                    "id": req_id,
                    "ok": True,
                    "duration": len(audio) / sample_rate,
                    "sample_rate": sample_rate,
                    "load": round(load_time, 2),
                    "gen": round(gen_time, 2),
                }
            )
            load_time = 0.0
        except Exception as exc:  # noqa: BLE001 - report any failure to the parent
            send({"id": req_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
