import json
import os
import sys
from pathlib import Path

import render_daemon_client as client
from render_daemon import _environment, _state
from render_daemon_client import enqueue_render_request, render_source_fingerprint, render_state_healthy


def prepare_checkpoints(root: Path) -> Path:
    checkpoint_dir = root / "checkpoints"
    checkpoint_dir.mkdir()
    for name in ["config.yaml", "gpt.pth", "s2mel.pth", "codec.pth"]:
        (checkpoint_dir / name).write_bytes(b"model")
    return checkpoint_dir


def healthy_state(root: Path, python: Path, phase: str = "ready") -> dict:
    return {
        "protocol": 1,
        "pid": os.getpid(),
        "phase": phase,
        "model_loaded": True,
        "python_executable": str(python.resolve()),
        "checkpoint_dir": str((root / "checkpoints").resolve()),
        "indextts_available": True,
        "checkpoint_files_ready": True,
        "runtime_healthy": True,
        "source_fingerprint": render_source_fingerprint(root),
    }


def test_render_runtime_health_requires_ready_matching_environment(tmp_path):
    python = Path(sys.executable)
    checkpoint_dir = prepare_checkpoints(tmp_path)
    assert render_state_healthy(healthy_state(tmp_path, python), python, checkpoint_dir) is True
    assert render_state_healthy(healthy_state(tmp_path, python, "busy"), python, checkpoint_dir) is False
    mismatched = healthy_state(tmp_path, tmp_path / "other-python.exe")
    assert render_state_healthy(mismatched, python, checkpoint_dir) is False
    stale_source = healthy_state(tmp_path, python)
    stale_source["source_fingerprint"] = "stale"
    assert render_state_healthy(stale_source, python, checkpoint_dir) is False


def test_render_request_is_written_atomically(tmp_path):
    runtime_dir = tmp_path / "runtime"
    input_path, result_path, status_path = tmp_path / "input.json", tmp_path / "result.json", tmp_path / "status.json"
    input_path.write_text("{}", encoding="utf-8")
    request_id, request_path = enqueue_render_request(runtime_dir, input_path, result_path, status_path)
    envelope = json.loads(request_path.read_text(encoding="utf-8"))
    assert request_path.name == f"{request_id}.json"
    assert envelope["input"] == str(input_path.resolve())
    assert not list(request_path.parent.glob("*.tmp"))


def test_render_environment_reports_checkpoint_and_python_fingerprint(tmp_path, monkeypatch):
    prepare_checkpoints(tmp_path)
    spec = type("Spec", (), {"origin": str(tmp_path / "indextts" / "__init__.py")})()
    monkeypatch.setattr("render_daemon.importlib.util.find_spec", lambda name: spec if name == "indextts" else None)
    environment = _environment(tmp_path)
    assert environment["python_executable"] == str(Path(sys.executable).resolve())
    assert environment["indextts_available"] is True
    assert environment["checkpoint_files_ready"] is True
    assert environment["runtime_healthy"] is True
    assert environment["source_fingerprint"] == render_source_fingerprint(tmp_path)


def test_render_state_retains_last_request_across_heartbeat():
    runtime = type("Runtime", (), {"model": object()})()
    payload = _state(runtime, 1.0, {"runtime_healthy": True}, {"last_request_id": "request-1"})
    assert payload["model_loaded"] is True
    assert payload["last_request_id"] == "request-1"


def test_release_render_model_returns_when_runtime_is_absent(tmp_path):
    assert client.release_render_model(tmp_path) == {"runtime_available": False, "released": False}


def test_render_daemon_always_uses_utf8_mode(monkeypatch):
    monkeypatch.setenv("PYTHONUTF8", "0")
    assert client.daemon_environment()["PYTHONUTF8"] == "1"
