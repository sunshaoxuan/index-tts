[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 7860,

    [string]$HostAddress = "127.0.0.1"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$modelDir = Join-Path $projectRoot "checkpoints"

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "Python virtual environment was not found at $python. Run uv sync first."
}

$requiredModelFiles = @(
    "config.yaml",
    "gpt.pth",
    "s2mel.pth",
    "codec.pth",
    "multilingual_zh_ja_yue_char_del.tiktoken"
)
foreach ($file in $requiredModelFiles) {
    $path = Join-Path $modelDir $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "IndexTTS 2.5 model file was not found: $path"
    }
}

$env:PYTHONUTF8 = "1"
Set-Location -LiteralPath $projectRoot
& $python "production_webui.py" `
    "--model-dir" $modelDir `
    "--host" $HostAddress `
    "--port" $Port
exit $LASTEXITCODE
