[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 7860,

    [string]$HostAddress = "127.0.0.1",

    [ValidateNotNullOrEmpty()]
    [string]$AiBaseUrl = "http://127.0.0.1:11434",

    [ValidateNotNullOrEmpty()]
    [string]$AiModel = "qwen3:8b",

    [ValidateRange(30, 1800)]
    [int]$AiTimeout = 120,

    [ValidateRange(1000, 6000)]
    [int]$AiChunkChars = 3600,

    [string]$VoiceDesignPython = "",

    [string]$VoiceDesignModel = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$modelDir = Join-Path $projectRoot "checkpoints"
if ([string]::IsNullOrWhiteSpace($VoiceDesignPython)) {
    $VoiceDesignPython = Join-Path $projectRoot ".venv-voice-design\Scripts\python.exe"
}
if ([string]::IsNullOrWhiteSpace($VoiceDesignModel)) {
    $VoiceDesignModel = Join-Path $modelDir "Qwen3-TTS-12Hz-1.7B-VoiceDesign"
}

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "Python virtual environment was not found at $python. Run uv sync first."
}

$requiredModelFiles = @(
    "config.yaml",
    "gpt.pth",
    "s2mel.pth",
    "codec.pth",
    "multilingual_zh_ja_yue_char_del.tiktoken",
    "qwen0.6bemo4-merge\config.json",
    "qwen0.6bemo4-merge\model.safetensors"
)
foreach ($file in $requiredModelFiles) {
    $path = Join-Path $modelDir $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "IndexTTS 2.5 model file was not found: $path"
    }
}

$normalizedAiBaseUrl = $AiBaseUrl.TrimEnd("/")
try {
    $aiTags = Invoke-RestMethod -Uri "$normalizedAiBaseUrl/api/tags" -TimeoutSec 10
}
catch {
    throw "Local AI service is unavailable at $normalizedAiBaseUrl. Start Ollama before IndexTTS. $($_.Exception.Message)"
}
$availableAiModels = @($aiTags.models | ForEach-Object { $_.name })
if ($AiModel -notin $availableAiModels) {
    throw "AI model $AiModel is unavailable. Available models: $($availableAiModels -join ', ')"
}

if (-not (Test-Path -LiteralPath $VoiceDesignPython -PathType Leaf)) {
    throw "Voice Design Python was not found at $VoiceDesignPython. Run scripts/setup_voice_design_windows.ps1 first."
}
& $VoiceDesignPython -c "import importlib.util, sys; missing = [name for name in ('qwen_tts', 'soundfile', 'torch') if importlib.util.find_spec(name) is None]; print('Missing Voice Design modules: ' + ', '.join(missing)) if missing else None; sys.exit(1 if missing else 0)"
if ($LASTEXITCODE -ne 0) {
    throw "Voice Design dependencies failed to import from $VoiceDesignPython."
}
foreach ($file in @("config.json", "model.safetensors")) {
    $path = Join-Path $VoiceDesignModel $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Voice Design model file was not found: $path"
    }
}

$env:PYTHONUTF8 = "1"
Set-Location -LiteralPath $projectRoot
& $python "production_webui.py" `
    "--model-dir" $modelDir `
    "--host" $HostAddress `
    "--port" $Port `
    "--ai-base-url" $normalizedAiBaseUrl `
    "--ai-model" $AiModel `
    "--ai-timeout" $AiTimeout `
    "--ai-chunk-chars" $AiChunkChars `
    "--voice-design-python" $VoiceDesignPython `
    "--voice-design-model" $VoiceDesignModel
exit $LASTEXITCODE
