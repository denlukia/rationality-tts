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
import gc
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import json
import sys
import uuid
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = Path(os.getenv("AUDIO_DIR", ROOT / "data" / "audio")).resolve()
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
CUSTOM_VOICE_DIR = Path(os.getenv("VOICES_DIR", ROOT / "data" / "voices" / "custom")).resolve()
CUSTOM_VOICE_DIR.mkdir(parents=True, exist_ok=True)
ENCODER = Path(os.getenv("VOICE_ENCODER_SCRIPT", ROOT / "tts" / "voice_encoder.py"))
VOICE_CHECKPOINT = Path(os.getenv("VOICE_ENCODER", ROOT / "models" / "holos" / "voice_encoder.pt"))

SAMPLE_RATE = 24000
VOICE = os.getenv("HOLOS_VOICE", "Speaker_84")
SPEED = float(os.getenv("HOLOS_SPEED", "1.0"))
BITRATE = os.getenv("HOLOS_BITRATE", "24k")
ENGINE_ENV = os.getenv("HOLOS_ENGINE", "auto").lower()
MLX_MODEL = os.getenv("HOLOS_MLX_MODEL", "patriotyk/HolosTTS/mlx")
ONNX_MODEL = os.getenv("HOLOS_ONNX_MODEL", "patriotyk/HolosTTS/onnx-int8")

# Drama 3 runs in its own virtualenv: mlx-audio has a different dependency set
# from HolosTTS, and a separate process lets us reclaim its ~23 GB of RAM.
DRAMA_MODEL = Path(os.getenv("DRAMA_MODEL", ROOT / "models" / "fish-audio-drama-3-3bit")).resolve()
DRAMA_PYTHON = os.getenv("DRAMA_PYTHON", str(ROOT / ".venv-drama" / "bin" / "python"))
DRAMA_WORKER = Path(os.getenv("DRAMA_WORKER", ROOT / "tts" / "drama_worker.py")).resolve()
DRAMA_VOICE_DIR = Path(os.getenv("DRAMA_VOICES_DIR", ROOT / "data" / "voices" / "drama")).resolve()
DRAMA_IDLE = float(os.getenv("DRAMA_IDLE", "300"))
# "worker" = local MLX process on Apple Silicon; "remote" = SGLang/vLLM server
# (Colab, RunPod, ...). Remote keeps this sidecar free of any Holos/Drama deps.
DRAMA_BACKEND = os.getenv("DRAMA_BACKEND", "worker").strip().lower()
DRAMA_REMOTE_URL = os.getenv("DRAMA_REMOTE_URL", "").strip().rstrip("/")
DRAMA_REMOTE_API = os.getenv("DRAMA_REMOTE_API", "sglang").strip().lower()
DRAMA_REMOTE_MODEL = os.getenv("DRAMA_REMOTE_MODEL", "fishaudio/drama-3")
DRAMA_REMOTE_TIMEOUT = float(os.getenv("DRAMA_REMOTE_TIMEOUT", "900"))
# Voice presets are static: listing voices must never load the model.
PRESETS_PATH = Path(os.getenv("HOLOS_PRESETS", ROOT / "tts" / "holos_presets.json")).resolve()

app = FastAPI(title="rationality-tts sidecar")
_model = None
_engine: Optional[str] = None
_stressifier = None
_model_lock = threading.Lock()
_synth_lock = threading.Lock()
_drama_proc: Optional[subprocess.Popen] = None
_drama_lock = threading.Lock()
_drama_last = 0.0


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


def normalize_engine(value: Optional[str]) -> str:
    v = (value or os.getenv("TTS_ENGINE") or "holos").strip().lower()
    return "drama" if v in ("drama", "drama3", "fish") else "holos"


def unload_holos() -> None:
    """Drop the Holos model so Drama can have the RAM."""
    global _model, _engine
    with _model_lock:
        if _model is None:
            return
        _model = None
        _engine = None
    gc.collect()
    try:
        import mlx.core as mx  # type: ignore

        mx.clear_cache()
    except Exception:
        pass
    print("[tts] holos unloaded", flush=True)


def drama_available() -> bool:
    if DRAMA_BACKEND == "remote":
        return bool(DRAMA_REMOTE_URL)
    return DRAMA_MODEL.is_dir() and DRAMA_WORKER.is_file() and Path(DRAMA_PYTHON).is_file()


def _start_drama() -> subprocess.Popen:
    global _drama_proc, _drama_last
    if not drama_available():
        raise HTTPException(503, "Drama 3 недоступна: немає моделі або .venv-drama")
    log_path = ROOT / "data" / "drama-worker.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log = open(log_path, "a", encoding="utf-8")
    _drama_proc = subprocess.Popen(
        [DRAMA_PYTHON, str(DRAMA_WORKER), "--model", str(DRAMA_MODEL)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=log,
        text=True,
        bufsize=1,
    )
    _drama_last = time.time()
    print("[tts] drama worker started", flush=True)
    return _drama_proc


def stop_drama() -> None:
    global _drama_proc
    if DRAMA_BACKEND == "remote":
        return
    proc, _drama_proc = _drama_proc, None
    if proc is None:
        return
    try:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
    except Exception:
        pass
    finally:
        for handle in (proc.stdin, proc.stdout):
            try:
                if handle:
                    handle.close()
            except Exception:
                pass
        print("[tts] drama worker stopped", flush=True)


def drama_request(payload: dict) -> dict:
    global _drama_last
    with _drama_lock:
        proc = _drama_proc if _drama_proc is not None and _drama_proc.poll() is None else _start_drama()
        if proc.stdin is None or proc.stdout is None:
            stop_drama()
            raise HTTPException(503, "Drama worker не запустився")
        req_id = uuid.uuid4().hex
        body = {**payload, "id": req_id}
        try:
            proc.stdin.write(json.dumps(body, ensure_ascii=False) + "\n")
            proc.stdin.flush()
            while True:
                line = proc.stdout.readline()
                if not line:
                    stop_drama()
                    raise HTTPException(503, "Drama worker завершився")
                try:
                    resp = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if resp.get("id") != req_id:
                    continue
                if not resp.get("ok"):
                    raise HTTPException(502, f"Drama: {resp.get('error', 'unknown error')}")
                _drama_last = time.time()
                return resp
        except (BrokenPipeError, OSError) as exc:
            stop_drama()
            raise HTTPException(503, f"Drama worker: {exc}")


def _drama_watchdog() -> None:
    while True:
        time.sleep(30)
        if _drama_proc is None or time.time() - _drama_last < DRAMA_IDLE:
            continue
        if not _drama_lock.acquire(blocking=False):
            continue
        try:
            if _drama_proc is not None and time.time() - _drama_last >= DRAMA_IDLE:
                stop_drama()
        finally:
            _drama_lock.release()


def list_drama_voices() -> dict:
    out: dict = {}
    if not DRAMA_VOICE_DIR.is_dir():
        return out
    for meta_path in sorted(DRAMA_VOICE_DIR.glob("*.json")):
        voice_id = meta_path.stem
        if not (DRAMA_VOICE_DIR / f"{voice_id}.wav").is_file():
            continue
        try:
            out[voice_id] = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            out[voice_id] = {}
    return out


def resolve_drama_voice(voice: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not voice or not voice.startswith("drama-"):
        return None, None
    wav_path = DRAMA_VOICE_DIR / f"{voice}.wav"
    if not wav_path.is_file():
        raise HTTPException(404, f"unknown drama voice: {voice}")
    ref_text = ""
    meta_path = DRAMA_VOICE_DIR / f"{voice}.json"
    if meta_path.is_file():
        try:
            ref_text = json.loads(meta_path.read_text(encoding="utf-8")).get("ref_text", "")
        except Exception:
            ref_text = ""
    return str(wav_path), ref_text


if DRAMA_BACKEND != "remote":
    threading.Thread(target=_drama_watchdog, daemon=True, name="drama-idle").start()


def get_stressifier():
    global _stressifier
    if _stressifier is None:
        with _model_lock:
            if _stressifier is None:
                from ukrainian_word_stress import Stressifier

                _stressifier = Stressifier()
                print("[tts] stressifier loaded", flush=True)
    return _stressifier



def load_custom_voice(voice_id: str):
    import numpy as np

    path = CUSTOM_VOICE_DIR / f"{voice_id}.npy"
    if not path.is_file():
        raise ValueError(f"unknown voice: {voice_id}")
    return np.load(path).astype("float32").reshape(-1)


def resolve_voice(voice: str):
    if voice.startswith("custom-"):
        return load_custom_voice(voice)
    return voice


def list_voices(engine: str = "holos") -> dict:
    custom = {}
    if CUSTOM_VOICE_DIR.is_dir():
        for meta_path in CUSTOM_VOICE_DIR.glob("*.json"):
            try:
                custom[meta_path.stem] = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                custom[meta_path.stem] = {}
    drama = list_drama_voices()
    presets: list = []
    # Never load the Holos model just to list voices: presets are static.
    if engine != "drama" and PRESETS_PATH.is_file():
        try:
            presets = json.loads(PRESETS_PATH.read_text(encoding="utf-8"))
        except Exception:
            presets = []
    return {
        "presets": presets,
        "custom": custom,
        "drama": drama,
        "all": presets + sorted(custom),
        "drama_all": sorted(drama),
    }



def phonemize(text: str) -> str:
    from ipa_uk import ipa

    stressed = get_stressifier()(text)
    return ipa(stressed)


def ffmpeg() -> Optional[str]:
    return shutil.which("ffmpeg")


def encode(wav: Path, key: str, speed: float = 1.0, tempo: bool = False) -> tuple[str, float]:
    """Encode WAV to compact Opus. Falls back to WAV if ffmpeg is missing."""
    exe = ffmpeg()
    if not exe:
        out = AUDIO_DIR / f"{key}.wav"
        shutil.move(str(wav), str(out))
        return out.name, out.stat().st_size / 32_000.0
    out = AUDIO_DIR / f"{key}.opus"
    filters: list[str] = []
    if tempo and abs(speed - 1.0) > 1e-3:
        filters = ["-filter:a", f"atempo={min(2.0, max(0.5, speed)):.4f}"]
    subprocess.run(
        [
            exe,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(wav),
            *filters,
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
    gap_sentence: Optional[float] = None
    engine: Optional[str] = None
    speed: Optional[float] = None


class PreviewBody(BaseModel):
    voice: str
    text: Optional[str] = None
    engine: Optional[str] = None
    speed: Optional[float] = None


def _safe_engine() -> Optional[str]:
    try:
        return detect_engine()
    except Exception:
        return None


@app.get("/health")
def health():
    drama_running = _drama_proc is not None and _drama_proc.poll() is None
    loaded = "drama" if drama_running else ("holos" if _model is not None else None)
    return {
        "engine": loaded or _engine or (ENGINE_ENV if ENGINE_ENV != "auto" else _safe_engine()),
        "loaded": loaded,
        "ready": loaded is not None,
        "drama": drama_available(),
        "drama_backend": DRAMA_BACKEND,
        "ffmpeg": bool(ffmpeg()),
        "format": "opus" if ffmpeg() else "wav",
    }


def _holos_synth(text: str, voice: Optional[str], key: str, speed: float) -> tuple[str, float]:
    model = get_model()
    sr = int(getattr(model, "sample_rate", SAMPLE_RATE))
    chunks: list[np.ndarray] = []
    total = 0.0
    for piece in split_long(text):
        audio = model.generate(phonemize(piece), voice=resolve_voice(voice or VOICE), speed=speed)
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
        file, _ = encode(tmp_path, key)
    finally:
        tmp_path.unlink(missing_ok=True)
    return file, total


def _drama_synth_remote(text: str, voice: Optional[str], key: str, speed: float) -> tuple[str, float]:
    import urllib.error
    import urllib.request

    unload_holos()
    ref_audio, ref_text = resolve_drama_voice(voice)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        if DRAMA_REMOTE_API == "vllm":
            payload: dict = {"model": DRAMA_REMOTE_MODEL, "input": text, "voice": "default", "response_format": "wav"}
            if ref_audio:
                payload["ref_audio"] = ref_audio
                payload["ref_text"] = ref_text
        else:
            payload = {"input": text, "response_format": "wav"}
            if ref_audio:
                payload["references"] = [{"audio_path": ref_audio, "text": ref_text}]
        url = f"{DRAMA_REMOTE_URL}/v1/audio/speech"
        req = urllib.request.Request(
            url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"content-type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=DRAMA_REMOTE_TIMEOUT) as resp:
                data = resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise HTTPException(exc.code, f"remote Drama: {detail or exc.reason}")
        except Exception as exc:
            raise HTTPException(503, f"remote Drama: {exc}")
        tmp_path.write_bytes(data)
        if tmp_path.stat().st_size == 0:
            raise HTTPException(502, "remote Drama: порожня відповідь")
        file, _ = encode(tmp_path, key, speed=speed, tempo=True)
    finally:
        tmp_path.unlink(missing_ok=True)
    try:
        duration = sf.info(str(AUDIO_DIR / file)).duration
    except Exception:
        duration = 0.0
    if speed and abs(speed - 1.0) > 1e-3:
        duration /= speed
    return file, duration


def _drama_synth(text: str, voice: Optional[str], key: str, speed: float) -> tuple[str, float]:
    if DRAMA_BACKEND == "remote":
        return _drama_synth_remote(text, voice, key, speed)
    unload_holos()
    ref_audio, ref_text = resolve_drama_voice(voice)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        resp = drama_request(
            {
                "cmd": "synth",
                "text": text,
                "out": str(tmp_path),
                "ref_audio": ref_audio,
                "ref_text": ref_text,
            }
        )
        file, _ = encode(tmp_path, key, speed=speed, tempo=True)
    finally:
        tmp_path.unlink(missing_ok=True)
    duration = float(resp.get("duration", 0.0))
    if speed and abs(speed - 1.0) > 1e-3:
        duration /= speed
    return file, duration


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
            return {
                "file": existing.name,
                "duration": round(info.duration, 3),
                "engine": normalize_engine(body.engine),
                "cached": True,
            }
        except Exception:
            pass

    engine = normalize_engine(body.engine)
    speed = float(body.speed) if body.speed else SPEED
    if speed <= 0:
        speed = 1.0

    with _synth_lock:
        if engine == "drama":
            file, duration = _drama_synth(text, body.voice, body.key, speed)
        else:
            stop_drama()
            file, duration = _holos_synth(text, body.voice, body.key, speed)

    return {
        "file": file,
        "duration": round(duration, 3),
        "engine": engine,
        "cached": False,
        "created": time.time(),
    }


@app.post("/preview")
def preview(body: PreviewBody):
    import hashlib

    text = (body.text or "Привіт, це приклад голосу. Слухайте, будь ласка.").strip()
    if not text:
        raise HTTPException(400, "empty text")
    engine = normalize_engine(body.engine)
    speed = float(body.speed) if body.speed else SPEED
    if speed <= 0:
        speed = 1.0
    voice = body.voice or ""
    key = "preview-" + hashlib.sha1(f"{engine}\n{voice}\n{speed}\n{text}".encode()).hexdigest()[:20]
    existing = next((p for p in (AUDIO_DIR / f"{key}.opus", AUDIO_DIR / f"{key}.wav") if p.exists()), None)
    if existing is not None:
        try:
            info = sf.info(str(existing))
            return {"file": existing.name, "duration": round(info.duration, 3), "cached": True}
        except Exception:
            pass
    with _synth_lock:
        if engine == "drama":
            file, duration = _drama_synth(text, voice or None, key, speed)
        else:
            stop_drama()
            file, duration = _holos_synth(text, voice or VOICE, key, speed)
    return {"file": file, "duration": round(duration, 3), "cached": False, "engine": engine}



@app.get("/voices")
def voices(engine: str = "holos"):
    return list_voices(normalize_engine(engine))


@app.post("/voices/drama")
async def create_drama_voice(
    file: UploadFile = File(...),
    name: str = Form("drama"),
    ref_text: str = Form(""),
):
    """Store a Drama 3 reference clip plus its transcript."""
    transcript = ref_text.strip()
    if not transcript:
        raise HTTPException(400, "потрібен текст референсного аудіо")
    ffmpeg_exe = ffmpeg()
    if not ffmpeg_exe:
        raise HTTPException(500, "ffmpeg is required to create voices")
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)
    DRAMA_VOICE_DIR.mkdir(parents=True, exist_ok=True)
    voice_id = f"drama-{uuid.uuid4().hex[:12]}"
    wav_path = DRAMA_VOICE_DIR / f"{voice_id}.wav"
    try:
        subprocess.run(
            [ffmpeg_exe, "-y", "-hide_banner", "-loglevel", "error", "-i", str(tmp_path),
             "-ar", "44100", "-ac", "1", str(wav_path)],
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        wav_path.unlink(missing_ok=True)
        raise HTTPException(500, f"could not decode reference audio: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)
    meta = {
        "name": name or "drama",
        "ref_text": transcript,
        "source": file.filename,
        "created": time.time(),
    }
    (DRAMA_VOICE_DIR / f"{voice_id}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"id": voice_id, "name": meta["name"]}


@app.post("/voices/custom")
async def create_voice(file: UploadFile = File(...), name: str = Form("custom")):
    if not ENCODER.is_file():
        raise HTTPException(500, "voice encoder script not found")
    CUSTOM_VOICE_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)
    wav_path = tmp_path.with_suffix(".wav")
    ffmpeg_exe = ffmpeg()
    if not ffmpeg_exe:
        raise HTTPException(500, "ffmpeg is required to create voices")
    subprocess.run(
        [ffmpeg_exe, "-y", "-hide_banner", "-loglevel", "error", "-i", str(tmp_path),
         "-ar", "24000", "-ac", "1", str(wav_path)],
        check=True,
    )
    voice_id = f"custom-{uuid.uuid4().hex[:12]}"
    out_npy = CUSTOM_VOICE_DIR / f"{voice_id}.npy"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT / "tts" / "HolosTTS") + os.pathsep + env.get("PYTHONPATH", "")
    cmd = [
        sys.executable, str(ENCODER), str(wav_path), str(out_npy),
        "--checkpoint", str(VOICE_CHECKPOINT),
    ]
    try:
        subprocess.run(cmd, check=True, env=env, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        tmp_path.unlink(missing_ok=True)
        wav_path.unlink(missing_ok=True)
        out_npy.unlink(missing_ok=True)
        raise HTTPException(500, f"voice encoding failed: {exc.stderr or exc}")
    meta = {"name": name, "source": file.filename, "created": time.time()}
    (CUSTOM_VOICE_DIR / f"{voice_id}.json").write_text(json.dumps(meta, ensure_ascii=False))
    tmp_path.unlink(missing_ok=True)
    wav_path.unlink(missing_ok=True)
    return {"id": voice_id, "name": name}


@app.delete("/voices/custom/{voice_id}")
def delete_voice(voice_id: str):
    if not voice_id.startswith("custom-"):
        raise HTTPException(400, "not a custom voice")
    removed = False
    for ext in (".npy", ".json", ".wav"):
        p = CUSTOM_VOICE_DIR / f"{voice_id}{ext}"
        if p.exists():
            p.unlink()
            removed = True
    if not removed:
        raise HTTPException(404, "voice not found")
    return {"deleted": voice_id}


@app.delete("/voices/drama/{voice_id}")
def delete_drama_voice(voice_id: str):
    if not voice_id.startswith("drama-"):
        raise HTTPException(400, "not a drama voice")
    removed = False
    for ext in (".wav", ".json"):
        p = DRAMA_VOICE_DIR / f"{voice_id}{ext}"
        if p.exists():
            p.unlink()
            removed = True
    if not removed:
        raise HTTPException(404, "voice not found")
    return {"deleted": voice_id}




VOWELS = {
    "ɑ": "AA", "a": "AA", "ɛ": "EH", "e": "EH", "ɪ": "IH", "i": "IY",
    "ɔ": "AO", "o": "AO", "u": "UW", "ʊ": "UH", "ə": "AH", "ɐ": "AH",
}
CONSONANTS = {
    "tʃ": "CH", "dʒ": "JH", "ts": "T S", "dz": "D Z",
    "p": "P", "b": "B", "t": "T", "d": "D", "k": "K", "ɡ": "G", "g": "G",
    "f": "F", "v": "V", "ʋ": "V", "w": "W", "s": "S", "z": "Z",
    "ʃ": "SH", "ʒ": "ZH", "x": "HH", "ɦ": "HH", "h": "HH",
    "m": "M", "n": "N", "l": "L", "ɫ": "L", "r": "R", "ɾ": "R", "j": "Y",
}


def ipa_to_arpabet(ipa_text: str) -> str:
    import re

    symbols = sorted({**VOWELS, **CONSONANTS}, key=len, reverse=True)
    pattern = re.compile("|".join(map(re.escape, symbols + ["ˈ", "ˌ"])))
    ipa = ipa_text.replace("\u0361", "").replace("\u035c", "")
    ipa = ipa.replace("ʲ", "").replace("ː", "")
    out, stress = [], "0"
    for tok in pattern.findall(ipa):
        if tok == "ˈ":
            stress = "1"
        elif tok == "ˌ":
            stress = "2"
        elif tok in VOWELS:
            out.append(VOWELS[tok] + stress)
            stress = "0"
        else:
            out.append(CONSONANTS[tok])
    return " ".join(out)


class IpaBody(BaseModel):
    text: str


@app.post("/ipa")
def ipa_endpoint(body: IpaBody):
    from ipa_uk import ipa as ipa_fn

    text = body.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    stressed = get_stressifier()(text)
    ipa_text = ipa_fn(stressed)
    return {
        "stressed": stressed,
        "ipa": ipa_text,
        "arpabet": ipa_to_arpabet(ipa_text),
    }



if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("TTS_HOST", "127.0.0.1"), port=int(os.getenv("TTS_PORT", "8767")))
