from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "scripts" / "start_indextts25_windows.ps1"


def test_windows_launcher_uses_local_v25_bf16_runtime():
    content = LAUNCHER.read_text(encoding="utf-8")

    assert '"production_webui.py"' in content
    assert '"--model-dir" $modelDir' in content
    assert '"--host" $HostAddress' in content
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
