[CmdletBinding()]
param(
    [string]$PythonCommand = "python",
    [string]$ModelId = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    [string]$TokenizerId = "Qwen/Qwen3-TTS-Tokenizer-12Hz"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentDir = Join-Path $projectRoot ".venv-voice-design"
$python = Join-Path $environmentDir "Scripts\python.exe"
$modelDir = Join-Path $projectRoot "checkpoints\Qwen3-TTS-12Hz-1.7B-VoiceDesign"
$tokenizerDir = Join-Path $projectRoot "checkpoints\Qwen3-TTS-Tokenizer-12Hz"

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    & $PythonCommand -m venv $environmentDir
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Voice Design virtual environment." }
}

& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Failed to update pip." }
& $python -m pip install torch==2.8.0+cu128 torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { throw "Failed to install the CUDA PyTorch packages." }
& $python -m pip install qwen-tts==0.1.1 huggingface-hub
if ($LASTEXITCODE -ne 0) { throw "Failed to install Qwen3-TTS Voice Design dependencies." }

& $python -m huggingface_hub.commands.huggingface_cli download $ModelId --local-dir $modelDir
if ($LASTEXITCODE -ne 0) { throw "Failed to download the Voice Design model." }
& $python -m huggingface_hub.commands.huggingface_cli download $TokenizerId --local-dir $tokenizerDir
if ($LASTEXITCODE -ne 0) { throw "Failed to download the Voice Design tokenizer." }

& $python -c "import qwen_tts, soundfile, torch; print(torch.__version__)"
if ($LASTEXITCODE -ne 0) { throw "Voice Design import verification failed." }
foreach ($path in @((Join-Path $modelDir "config.json"), (Join-Path $modelDir "model.safetensors"))) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required model file was not found: $path" }
}
Write-Host "Voice Design environment is ready at $environmentDir"
