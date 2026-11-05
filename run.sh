#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python}"
if [ -x .venv/bin/python ]; then
	PY=".venv/bin/python"
fi

"$PY" tts/server.py &
TTS_PID=$!
trap 'kill "$TTS_PID" 2>/dev/null || true' EXIT INT TERM

bun run dev
