from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "scripts" / "start_indextts25_windows.ps1"


def test_windows_launcher_uses_local_v25_bf16_runtime():
    content = LAUNCHER.read_text(encoding="utf-8")

    assert '"production_webui.py"' in content
    assert '"--model-dir" $modelDir' in content
    assert '"--host" $HostAddress' in content
    assert '"--ai-base-url" $normalizedAiBaseUrl' in content
    assert '"--ai-model" $AiModel' in content
    assert '"--ai-timeout" $AiTimeout' in content
    assert '"--ai-chunk-chars" $AiChunkChars' in content
    assert '$env:PYTHONUTF8 = "1"' in content
    assert "--cuda_kernel" not in content
    assert "--torch_compile" not in content
    assert "--deepspeed" not in content


def test_windows_launcher_checks_all_required_v25_files():
    content = LAUNCHER.read_text(encoding="utf-8")

    for filename in (
        "config.yaml",
        "gpt.pth",
        "s2mel.pth",
        "codec.pth",
        "multilingual_zh_ja_yue_char_del.tiktoken",
        "qwen0.6bemo4-merge\\config.json",
        "qwen0.6bemo4-merge\\model.safetensors",
    ):
        assert f'"{filename}"' in content


def test_local_runtime_assets_are_ignored():
    content = (ROOT / ".gitignore").read_text(encoding="utf-8")

    assert "/checkpoints/config.yaml" in content
    assert "/runtime-output/" in content


def test_windows_launcher_requires_local_ai_service_and_model():
    content = LAUNCHER.read_text(encoding="utf-8")

    assert '[string]$AiBaseUrl = "http://127.0.0.1:11434"' in content
    assert '[string]$AiModel = "qwen3:8b"' in content
    assert '[int]$AiTimeout = 300' in content
    assert '[int]$AiChunkChars = 1400' in content
    assert 'Invoke-RestMethod -Uri "$normalizedAiBaseUrl/api/tags"' in content
    assert "$AiModel -notin $availableAiModels" in content


def test_windows_launcher_checks_voice_design_runtime_and_model():
    content = LAUNCHER.read_text(encoding="utf-8")
    setup = (ROOT / "scripts" / "setup_voice_design_windows.ps1").read_text(encoding="utf-8")

    assert '"--voice-design-python" $VoiceDesignPython' in content
    assert '"--voice-design-model" $VoiceDesignModel' in content
    assert "importlib.util.find_spec" in content
    assert '"config.json", "model.safetensors"' in content
    assert "qwen-tts==0.1.1" in setup
    assert "Qwen3-TTS-12Hz-1.7B-VoiceDesign" in setup
