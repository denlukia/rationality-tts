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

### Optional: Fish Audio Drama 3

The settings panel can switch between HolosTTS and **Fish Audio Drama 3** (`engine: "drama"`).
Drama 3 is a 35B MoE voice-cloning model: it needs a reference clip and its transcript, runs
at roughly real time on an M1 Pro, and takes ~23 GB of RAM. The sidecar starts it only when
needed and stops it after 5 idle minutes.

Apple Silicon only, and use the **3-bit** checkpoint — the 4-bit one peaks at ~26 GB and does
not fit a 32 GB machine:

```bash
hf download mlx-community/fish-audio-drama-3-3bit --local-dir models/fish-audio-drama-3-3bit

uv venv .venv-drama --python 3.11
uv pip install --python .venv-drama/bin/python "mlx-audio>=0.6.2" soundfile
```

Then in **налаштування → модель** pick *Fish Drama 3*, upload or record a reference clip,
and type exactly what is said in it. Without a reference the model picks a voice on its own,
which is not stable across sentences. Drama ignores IPA phonemes (it reads raw text) and
applies the speed setting afterwards with `ffmpeg atempo`.

## Using it

1. Expand a book and a chapter; pick an essay.
2. Click a sentence to open the right panel.
   - **зберегти** stores the patch in `data/db.json`.
   - **TTS** synthesizes the patched (or original) sentence.
   - **прослухати** plays just that sentence.
3. Click a sentence to place the playhead on it. The bottom controls act from there:
   - play / synthesize the previous, current or next sentence, the rest of the paragraph, or
     everything after the playhead.
4. Sentence styling is the only status UI:
   - black — no audio yet;
   - green — TTSed and up to date;
   - yellow — audio exists but the patch or settings changed;
   - reversed (status colour as background) — selected in the right panel;
   - 1.5px rounded red outline — currently playing.
5. Click any pie in the left tree to see the exact added/removed paragraphs. **позначити
   переглянутим** clears the yellow “needs update” state for that book, chapter or essay.
   **не потребує TTS / потребує TTS** marks or unmarks a book, chapter or essay as not
   requiring narration (excluded from the pies).

## Updating the books

```bash
git -C content pull
```

Reload the app. Paragraphs added, changed or removed since the last acknowledgement turn
yellow at essay, chapter and book level. The pie dialog lists the old/new text so you can
decide what to patch and re-synthesize. Nothing is regenerated automatically.

## Storage

The database is split into **one JSON file per essay** under `data/db/` (mirroring the
content tree). Each file stores the acknowledged paragraph hashes, patches and audio
metadata for that essay only. This keeps git diffs and merges local: editing one sentence
touches one small file instead of rewriting a multi-megabyte `db.json`.

`data/audio/<sha1-of-text>.opus` contains one compressed clip per sentence. Opus at 24 kbps
mono is roughly **11 MB per hour** of speech, so a fully narrated library stays small enough
for a normal git repository. Commit `data/` (or the separate data repo) if you want the
narration to travel with the app; on very large libraries consider Git LFS. Without ffmpeg
the sidecar writes `.wav` instead (much larger) and the app still works.

## Syncing across machines

`data/` can be a git repository of its own (the project ships a separate
`rationality-tts-data` repo for this). The app has a tiny session widget in the bottom-left
corner:

- `⏱ 9:58` shows the remaining runtime when `SESSION_BUDGET_SEC` is set (Colab).
- a green/amber/red dot shows whether the working tree is clean, dirty or has a push error.
- click it to see the last commit and **зберегти зараз**.

The server auto-commits every 5 minutes (`AUTOSAVE_SEC`) when there are changes. On Colab
the app is gated behind a GitHub token (fine-grained PAT with Contents read/write on the
data repo): paste it on the first screen and the server clones the data repo into `data/`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SESSION_REQUIRE_AUTH` | `0` | set to `1` to require a GitHub token to use the app |
| `SESSION_BUDGET_SEC` | `0` | runtime budget shown by the timer (0 = hidden) |
| `GITHUB_REPO` | `denlukia/rationality-tts-data` | data repo cloned by the session screen |
| `AUTOSAVE_SEC` | `0` | auto-commit interval (0 = off) |
| `GITHUB_TOKEN` | (none) | optional token supplied at boot instead of the UI |
| `DEFAULT_ENGINE` | (none) | force `holos` or `drama` (also `TTS_ENGINE`) |

## Running on Colab (Drama 3 only)

See `colab/drama.ipynb`. It installs Node + the SvelteKit app, SGLang-Omni and the Drama 3
int4 checkpoint, then exposes the app through a `cloudflared` tunnel. The first cold start
takes ~10–20 minutes; with Pro+ continuous execution a runtime lives up to 24 h.

On Colab the engine is locked to Drama (`TTS_ENGINE=drama`, `DRAMA_BACKEND=remote`,
pointing at the local SGLang server). HolosTTS is never installed there; the sidecar
returns static voice presets so listing voices does not load a model.

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
| `HOLOS_SPEED` | `1.0` | default speaking speed |
| `TTS_ENGINE` | `holos` | default engine when the request omits one |
| `DRAMA_BACKEND` | `worker` | `worker` (local MLX) or `remote` (SGLang/vLLM) |
| `DRAMA_REMOTE_URL` | (none) | remote Drama server address |
| `DRAMA_REMOTE_API` | `sglang` | `sglang` or `vllm` request schema |
| `DRAMA_MODEL` | `models/fish-audio-drama-3-3bit` | local Drama 3 MLX checkpoint |
| `DRAMA_PYTHON` | `.venv-drama/bin/python` | interpreter with `mlx-audio` installed |
| `DRAMA_IDLE` | `300` | seconds before the idle Drama worker is stopped |
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
data/db/                  # one JSON file per essay
data/audio/*.opus         # one clip per sentence
src/lib/server/db.ts      # per-essay DB
src/lib/server/library.ts # status aggregation, change detection
src/lib/server/session.ts # git sync, timer, auth
src/lib/components/SessionWidget.svelte
src/lib/components/LoginScreen.svelte
src/routes/api/session/   # connect, commit, status
src/hooks.server.ts       # auth gate
colab/drama.ipynb         # Colab workspace for Drama 3
tts/server.py             # engine router sidecar (HolosTTS + Drama 3 worker/remote)
tts/drama_worker.py       # Drama 3 model process (own venv, JSON-lines protocol)
```

This is intentionally smaller than the reference HolosTTS playground: no voices UI, no
per-block settings, no export. The unit of work is a sentence.
