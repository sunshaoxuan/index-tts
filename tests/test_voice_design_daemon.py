import json
import os
import sys
import time
from pathlib import Path

import voice_design_daemon_client as daemon_client
from voice_design_daemon import _runtime_environment, _state_payload, _within
from voice_design_daemon_client import enqueue_voice_design_request, ensure_voice_design_daemon, process_alive, read_runtime_state, release_voice_design_model


def prepare_model(root: Path) -> Path:
    model_dir = root / "checkpoints" / "Qwen3-TTS-12Hz-1.7B-VoiceDesign"
    (model_dir / "speech_tokenizer").mkdir(parents=True)
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / "model.safetensors").write_bytes(b"model")
    return model_dir


def healthy_state(root: Path, python: Path, pid: int) -> dict:
    return {
        "protocol": 2,
        "pid": pid,
        "phase": "ready",
        "model_loaded": True,
        "python_executable": str(python.resolve()),
        "python_prefix": str(python.parent.resolve()),
        "qwen_tts_available": True,
        "qwen_tts_origin": str(root / "qwen_tts" / "__init__.py"),
        "model_dir": str((root / "checkpoints" / "Qwen3-TTS-12Hz-1.7B-VoiceDesign").resolve()),
        "model_files_ready": True,
        "runtime_healthy": True,
    }


def test_process_alive_recognizes_the_current_process():
    assert process_alive(os.getpid()) is True


def test_process_alive_rejects_an_invalid_pid():
    assert process_alive(2_147_483_647) is False


def test_daemon_client_reuses_a_live_runtime_state(tmp_path):
    python = Path(sys.executable)
    prepare_model(tmp_path)
    runtime_dir = tmp_path / "runtime-output" / "voice-design-runtime"
    runtime_dir.mkdir(parents=True)
    (runtime_dir / "state.json").write_text(
        json.dumps(healthy_state(tmp_path, python, os.getpid())),
        encoding="utf-8",
    )

    state = ensure_voice_design_daemon(tmp_path, python)

    assert state["reused_process"] is True
    assert state["model_loaded"] is True
    assert read_runtime_state(runtime_dir)["pid"] == os.getpid()


def test_daemon_client_accepts_the_runtime_pid_behind_a_windows_launcher(tmp_path, monkeypatch):
    python = tmp_path / "voice-python.exe"
    prepare_model(tmp_path)
    runtime_dir = tmp_path / "runtime-output" / "voice-design-runtime"
    started_at = time.time()
    started_state = healthy_state(tmp_path, python, 222)
    started_state["started_at"] = started_at
    states = iter(
        [
            None,
            started_state,
        ]
    )

    class FakeChild:
        pid = 111

        @staticmethod
        def poll():
            return None

    monkeypatch.setattr(daemon_client, "read_runtime_state", lambda _runtime_dir: next(states))
    monkeypatch.setattr(daemon_client.subprocess, "Popen", lambda *args, **kwargs: FakeChild())

    state = ensure_voice_design_daemon(tmp_path, python, timeout_seconds=1)

    assert state["pid"] == 222
    assert state["reused_process"] is False
    assert state["runtime_dir"] == str(runtime_dir)


def test_daemon_request_is_atomic_and_points_to_the_original_job_files(tmp_path):
    runtime_dir = tmp_path / "runtime"
    input_path = tmp_path / "input.json"
    result_path = tmp_path / "result.json"
    status_path = tmp_path / "status.json"
    input_path.write_text("{}", encoding="utf-8")

    request_id, request_path = enqueue_voice_design_request(runtime_dir, input_path, result_path, status_path)
    envelope = json.loads(request_path.read_text(encoding="utf-8"))

    assert request_path.name == f"{request_id}.json"
    assert envelope["protocol"] == 2
    assert envelope["input"] == str(input_path.resolve())
    assert envelope["result"] == str(result_path.resolve())
    assert envelope["status"] == str(status_path.resolve())
    assert not list(request_path.parent.glob("*.tmp"))


def test_daemon_rejects_paths_outside_the_repository(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    outside = tmp_path / "outside.json"

    try:
        _within(outside, repo)
    except ValueError as error:
        assert "超出工程目录" in str(error)
    else:
        raise AssertionError("outside path was accepted")


def test_release_voice_design_model_returns_without_request_for_cold_runtime(tmp_path):
    assert release_voice_design_model(tmp_path) == {"runtime_available": False, "released": False}


def test_release_voice_design_model_waits_for_matching_response(tmp_path, monkeypatch):
    runtime_dir = tmp_path / "runtime-output" / "voice-design-runtime"
    runtime_dir.mkdir(parents=True)
    response_path = runtime_dir / "release-response.json"
    states = iter(
        [
            {"protocol": 2, "pid": 321, "phase": "ready", "model_loaded": True},
            {"protocol": 2, "pid": 321, "phase": "ready", "model_loaded": False},
        ]
    )
    monkeypatch.setattr(daemon_client, "read_runtime_state", lambda _runtime_dir: next(states))
    monkeypatch.setattr(daemon_client.time, "sleep", lambda _seconds: None)

    original_replace = daemon_client.os.replace

    def replace_and_respond(source, destination):
        original_replace(source, destination)
        request = json.loads(Path(destination).read_text(encoding="utf-8"))
        response_path.write_text(
            json.dumps({"protocol": 2, "request_id": request["request_id"], "released": True, "completed_at": 12.5}),
            encoding="utf-8",
        )

    monkeypatch.setattr(daemon_client.os, "replace", replace_and_respond)
    result = release_voice_design_model(tmp_path, timeout_seconds=1)

    assert result == {"runtime_available": True, "released": True, "pid": 321, "completed_at": 12.5}
    assert not (runtime_dir / "release.request.tmp").exists()


def test_daemon_client_retires_state_without_environment_fingerprint(tmp_path, monkeypatch):
    runtime_dir = tmp_path / "runtime-output" / "voice-design-runtime"
    runtime_dir.mkdir(parents=True)
    (runtime_dir / "state.json").write_text(json.dumps({"protocol": 1, "pid": 456}), encoding="utf-8")
    retired = []
    monkeypatch.setattr(daemon_client, "_retire_existing_runtime", lambda path: retired.append(path))
    monkeypatch.setattr(daemon_client.subprocess, "Popen", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("launch reached")))

    try:
        ensure_voice_design_daemon(tmp_path, tmp_path / "python.exe")
    except RuntimeError as error:
        assert str(error) == "launch reached"
    assert retired == [runtime_dir]


def test_daemon_client_retires_python_mismatch_and_unavailable_qwen(tmp_path, monkeypatch):
    prepare_model(tmp_path)
    runtime_dir = tmp_path / "runtime-output" / "voice-design-runtime"
    runtime_dir.mkdir(parents=True)
    state = healthy_state(tmp_path, tmp_path / "wrong-python.exe", os.getpid())
    state["qwen_tts_available"] = False
    (runtime_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")
    retired = []
    monkeypatch.setattr(daemon_client, "_retire_existing_runtime", lambda path: retired.append(path))
    monkeypatch.setattr(daemon_client.subprocess, "Popen", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("launch reached")))

    try:
        ensure_voice_design_daemon(tmp_path, tmp_path / "expected-python.exe")
    except RuntimeError:
        pass
    assert retired == [runtime_dir]


def test_daemon_client_does_not_reuse_a_stopped_runtime(tmp_path):
    python = Path(sys.executable)
    model_dir = prepare_model(tmp_path)
    state = healthy_state(tmp_path, python, os.getpid())
    state["phase"] = "stopped"

    assert daemon_client.runtime_state_healthy(state, python, model_dir) is False


def test_state_payload_retains_last_error_across_heartbeat(tmp_path):
    runtime = type("Runtime", (), {"model": None, "model_dir": None})()
    environment = {"runtime_healthy": True}
    retained = {"last_request_id": "request-1", "last_error": "example failure"}

    state = _state_payload(runtime, 1.0, environment, retained)

    assert state["last_request_id"] == "request-1"
    assert state["last_error"] == "example failure"


def test_runtime_environment_contains_python_package_and_model_fingerprint(tmp_path, monkeypatch):
    prepare_model(tmp_path)
    fake_spec = type("Spec", (), {"origin": str(tmp_path / "site-packages" / "qwen_tts" / "__init__.py")})()
    monkeypatch.setattr("voice_design_daemon.importlib.util.find_spec", lambda name: fake_spec if name == "qwen_tts" else None)

    environment = _runtime_environment(tmp_path)

    assert environment["python_executable"] == str(Path(sys.executable).resolve())
    assert environment["qwen_tts_available"] is True
    assert environment["model_files_ready"] is True
    assert environment["runtime_healthy"] is True
