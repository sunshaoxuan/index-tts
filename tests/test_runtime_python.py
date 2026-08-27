from pathlib import Path

import runtime_python


def test_configured_interpreters_override_platform_defaults(tmp_path, monkeypatch):
    main = tmp_path / "main" / "python"
    voice = tmp_path / "voice" / "python"
    monkeypatch.setenv("INDEXTTS_PYTHON", str(main))
    monkeypatch.setenv("INDEXTTS_VOICE_PYTHON", str(voice))

    assert runtime_python.main_python(tmp_path) == main.absolute()
    assert runtime_python.voice_python(tmp_path) == voice.absolute()


def test_voice_interpreter_reuses_main_interpreter_on_linux(tmp_path, monkeypatch):
    configured = tmp_path / "shared" / "python"
    monkeypatch.setenv("INDEXTTS_PYTHON", str(configured))
    monkeypatch.delenv("INDEXTTS_VOICE_PYTHON", raising=False)
    assert runtime_python.voice_python(Path(tmp_path), platform="posix") == configured.absolute()


def test_configured_interpreter_preserves_virtualenv_symlink(tmp_path, monkeypatch):
    target = tmp_path / "system" / "python"
    target.parent.mkdir()
    target.write_text("python", encoding="utf-8")
    virtualenv_python = tmp_path / "voice-venv" / "python"
    virtualenv_python.parent.mkdir()
    try:
        virtualenv_python.symlink_to(target)
    except OSError:
        import pytest

        pytest.skip("file symlinks are unavailable on this host")

    monkeypatch.setenv("INDEXTTS_VOICE_PYTHON", str(virtualenv_python))

    selected = runtime_python.voice_python(tmp_path)
    assert selected == virtualenv_python.absolute()
    assert selected != target.resolve()
