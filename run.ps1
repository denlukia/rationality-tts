$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = if (Test-Path ".venv\Scripts\python.exe") { ".venv\Scripts\python.exe" } else { "python" }
$tts = Start-Process -FilePath $python -ArgumentList "tts/server.py" -PassThru

try {
	bun run dev
} finally {
	Stop-Process -Id $tts.Id -ErrorAction SilentlyContinue
}
