# rationality tts

A minimal reading + narration app for the Ukrainian translation of
[*Rationality: From AI to Zombies*](https://github.com/DanTheStrongworded/rationality-ua).

- **Left** — every book → chapter → essay, each level with a completion pie.
- **Center** — one essay at a time, split into hashable sentences, with a movable playhead.
- **Right** — click a sentence: original text, an editable patch, and HolosTTS synthesis.
- **Bottom** — play / synthesize the sentence before, after, to the end of the paragraph, or everything after the playhead.
- **Data** — `data/db.json` stores patches, sentence hashes and audio paths. Audio is Opus, 24 kbps mono.

The SvelteKit/TypeScript side owns the whole app: scanning Markdown, hashing sentences,
tracking repo changes, aggregation, DB, UI. Python is only a small HolosTTS sidecar.

## Requirements

| Tool | Why |
| --- | --- |
| [Bun](https://bun.sh) ≥ 1.1 | installs and runs SvelteKit |
| Python 3.11 or 3.12 | HolosTTS sidecar |
| [ffmpeg](https://ffmpeg.org) | compresses WAV to Opus (fallback: uncompressed WAV) |
| git | the book content is a submodule |

Install ffmpeg:

```bash
# macOS
brew install ffmpeg

# Windows (PowerShell)
winget install Gyan.FFmpeg

# Debian / Ubuntu
sudo apt install ffmpeg
```

## Setup

```bash
git clone --recurse-submodules https://github.com/<you>/rationality-tts.git
cd rationality-tts

bun install

python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows (PowerShell)
# .venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -r tts/requirements.txt
```

If you cloned without submodules:

```bash
git submodule update --init --recursive
```

The books live at `content/books` (the `rationality-ua` repo is the submodule).

## Run

Two processes: the HolosTTS sidecar on `127.0.0.1:8767`, and the SvelteKit dev server on
`127.0.0.1:5173`.

```bash
# terminal 1 — TTS sidecar
bun run tts

# terminal 2 — app
bun run dev
```

Open <http://localhost:5173>.

Or start both:

```bash
./run.sh          # macOS / Linux
.\run.ps1         # Windows PowerShell
```

The first synthesis downloads the model:

- **MLX** (Apple Silicon, default): `patriotyk/HolosTTS/mlx`, about 540 MB.
- **ONNX** (Windows, Linux, Intel Macs): `patriotyk/HolosTTS/onnx-int8`, about 90 MB.

Engine selection is automatic at runtime: Apple Silicon with `holos-tts-mlx` installed uses
MLX, everything else uses ONNX. Force one with `HOLOS_ENGINE=mlx` or `HOLOS_ENGINE=onnx`.

## Using it

1. Expand a book and a chapter; pick an essay.
2. Click a sentence to open the right panel.
   - **зберегти** stores the patch in `data/db.json`.
   - **TTS** synthesizes the patched (or original) sentence.
   - **прослухати** plays just that sentence.
3. Click the thin space between sentences (or between paragraphs) to place the playhead
   *between* items; click a sentence to place it *on* that sentence. The current position is
   shown above the bottom controls.
4. The eight bottom buttons act from the playhead:
   - play sentence before / one after / to the end of the paragraph / everything after;
   - the same four actions for TTS.
5. Sentence styling is the only status UI:
   - green — TTSed and up to date;
   - yellow — audio exists but the patch changed, or the paragraph needs review;
   - black — default;
   - white on black — currently playing;
   - bold — selected in the right panel.
6. Click any pie in the left tree to see the exact added/removed paragraphs. **позначити
   переглянутим** clears the yellow “needs update” state for that book, chapter or essay.

## Updating the books

```bash
git -C content pull
```

Reload the app. Paragraphs added, changed or removed since the last acknowledgement turn
yellow at essay, chapter and book level. The pie dialog lists the old/new text so you can
decide what to patch and re-synthesize. Nothing is regenerated automatically.

## Storage

`data/db.json` is the whole database. It stores, per essay:

- the acknowledged paragraph hashes (the “known” baseline),
- patches keyed by paragraph hash + sentence hash,
- audio file names and durations for each synthesized sentence.

`data/audio/<sha1-of-text>.opus` contains one compressed clip per sentence. Opus at 24 kbps
mono is roughly **11 MB per hour** of speech, so a fully narrated library stays small enough
for a normal git repository. Commit `data/` if you want the narration to travel with the app;
on very large libraries consider Git LFS. Without ffmpeg the sidecar writes `.wav` instead
(much larger) and the app still works.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CONTENT_DIR` | `content/books` | folder scanned for books |
| `DATA_DIR` | `data` | DB and audio root |
| `TTS_URL` | `http://127.0.0.1:8767` | sidecar address used by SvelteKit |
| `TTS_PORT` | `8767` | sidecar listen port |
| `HOLOS_ENGINE` | `auto` | `auto`, `mlx` or `onnx` |
| `HOLOS_MLX_MODEL` | `patriotyk/HolosTTS/mlx` | MLX model repo |
| `HOLOS_ONNX_MODEL` | `patriotyk/HolosTTS/onnx-int8` | ONNX model repo |
| `HOLOS_VOICE` | `Speaker_84` | preset voice name |
| `HOLOS_BITRATE` | `24k` | Opus bitrate |
| `HOLOS_SPEED` | `1.0` | speaking speed |
| `PYTHON` | `python` | interpreter used by `run.sh` |
| `AUDIO_DIR` | `data/audio` | where the sidecar writes clips |

## Windows notes

- Use PowerShell. Activate with `.venv\Scripts\Activate.ps1`; if execution policy blocks it,
  run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- Install ffmpeg with `winget install Gyan.FFmpeg` and reopen the terminal.
- `bun run dev` and `bun run tts` work the same. `.\run.ps1` starts both.
- MLX is Apple-only. Windows uses the ONNX model automatically; no CUDA setup is needed.

## Layout

```
content/                  # git submodule: rationality-ua
data/db.json              # patches, hashes, audio paths
data/audio/*.opus         # one clip per sentence
src/lib/server/content.ts # Markdown scan, sentence split, hashing
src/lib/server/library.ts # status aggregation, change detection
src/lib/server/db.ts      # JSON DB
src/routes/api/           # essay, patch, tts, ack
tts/server.py             # HolosTTS sidecar (thin)
```

This is intentionally smaller than the reference HolosTTS playground: no voices UI, no
per-block settings, no export. The unit of work is a sentence.
