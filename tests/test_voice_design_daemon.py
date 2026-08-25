import json
import os
import time
from pathlib import Path

import voice_design_daemon_client as daemon_client
from voice_design_daemon import _within
from voice_design_daemon_client import enqueue_voice_design_request, ensure_voice_design_daemon, process_alive, read_runtime_state, release_voice_design_model


def test_process_alive_recognizes_the_current_process():
    assert process_alive(os.getpid()) is True


def test_process_alive_rejects_an_invalid_pid():
    assert process_alive(2_147_483_647) is False


def test_daemon_client_reuses_a_live_runtime_state(tmp_path):
    runtime_dir = tmp_path / "runtime-output" / "voice-design-runtime"
    runtime_dir.mkdir(parents=True)
    (runtime_dir / "state.json").write_text(
        json.dumps({"protocol": 1, "pid": os.getpid(), "phase": "ready", "model_loaded": True}),
        encoding="utf-8",
    )

    state = ensure_voice_design_daemon(tmp_path, Path("unused-python.exe"))

    assert state["reused_process"] is True
    assert state["model_loaded"] is True
    assert read_runtime_state(runtime_dir)["pid"] == os.getpid()


def test_daemon_client_accepts_the_runtime_pid_behind_a_windows_launcher(tmp_path, monkeypatch):
    runtime_dir = tmp_path / "runtime-output" / "voice-design-runtime"
    started_at = time.time()
    states = iter(
        [
            None,
            {"protocol": 1, "pid": 222, "phase": "ready", "model_loaded": False, "started_at": started_at},
        ]
    )

    class FakeChild:
        pid = 111

        @staticmethod
        def poll():
            return None

    monkeypatch.setattr(daemon_client, "read_runtime_state", lambda _runtime_dir: next(states))
    monkeypatch.setattr(daemon_client.subprocess, "Popen", lambda *args, **kwargs: FakeChild())

    state = ensure_voice_design_daemon(tmp_path, Path("voice-python.exe"), timeout_seconds=1)

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
    assert envelope["protocol"] == 1
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
            {"protocol": 1, "pid": 321, "phase": "ready", "model_loaded": True},
            {"protocol": 1, "pid": 321, "phase": "ready", "model_loaded": False},
        ]
    )
    monkeypatch.setattr(daemon_client, "read_runtime_state", lambda _runtime_dir: next(states))
    monkeypatch.setattr(daemon_client.time, "sleep", lambda _seconds: None)

    original_replace = daemon_client.os.replace

    def replace_and_respond(source, destination):
        original_replace(source, destination)
        request = json.loads(Path(destination).read_text(encoding="utf-8"))
        response_path.write_text(
            json.dumps({"protocol": 1, "request_id": request["request_id"], "released": True, "completed_at": 12.5}),
            encoding="utf-8",
        )

    monkeypatch.setattr(daemon_client.os, "replace", replace_and_respond)
    result = release_voice_design_model(tmp_path, timeout_seconds=1)

    assert result == {"runtime_available": True, "released": True, "pid": 321, "completed_at": 12.5}
    assert not (runtime_dir / "release.request.tmp").exists()
