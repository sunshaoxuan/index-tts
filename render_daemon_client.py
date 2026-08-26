from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

from voice_design_daemon_client import process_alive

PROTOCOL_VERSION = 1


def daemon_environment() -> dict[str, str]:
    return {**os.environ, "PYTHONUTF8": "1"}


def read_render_state(runtime_dir: Path) -> dict[str, Any] | None:
    try:
        state = json.loads((runtime_dir / "state.json").read_text(encoding="utf-8"))
        if int(state.get("protocol", 0)) != PROTOCOL_VERSION or not process_alive(state.get("pid")):
            return None
        return state
    except (OSError, ValueError, TypeError):
        return None


def render_state_healthy(state: dict[str, Any], expected_python: Path, checkpoint_dir: Path) -> bool:
    required = [checkpoint_dir / "config.yaml", checkpoint_dir / "gpt.pth", checkpoint_dir / "s2mel.pth", checkpoint_dir / "codec.pth"]
    try:
        return (
            state.get("phase") == "ready"
            and Path(str(state["python_executable"])).resolve() == expected_python.resolve()
            and Path(str(state["checkpoint_dir"])).resolve() == checkpoint_dir.resolve()
            and state.get("indextts_available") is True
            and state.get("checkpoint_files_ready") is True
            and state.get("runtime_healthy") is True
            and all(path.is_file() for path in required)
        )
    except (KeyError, OSError, TypeError, ValueError):
        return False


def _retire_existing_runtime(runtime_dir: Path, timeout_seconds: float = 10) -> None:
    try:
        state = json.loads((runtime_dir / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return
    if not process_alive(state.get("pid")):
        return
    temporary = runtime_dir / "stop.request.tmp"
    temporary.write_text(json.dumps({"requested_at": time.time()}), encoding="utf-8")
    os.replace(temporary, runtime_dir / "stop.request")
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if not process_alive(state.get("pid")):
            return
        time.sleep(0.1)
    raise TimeoutError("旧 IndexTTS Render Runtime 未在期限内停止")


def ensure_render_daemon(root: Path, python: Path, timeout_seconds: float = 45) -> dict[str, Any]:
    root = root.resolve()
    runtime_dir = root / "runtime-output" / "render-runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_dir = root / "checkpoints"
    state = read_render_state(runtime_dir)
    if state and render_state_healthy(state, python, checkpoint_dir):
        return {**state, "reused_process": True, "runtime_dir": str(runtime_dir)}
    _retire_existing_runtime(runtime_dir)
    log_path = runtime_dir / "daemon.log"
    creationflags = (
        getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        | getattr(subprocess, "DETACHED_PROCESS", 0)
        | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )
    launched_at = time.time()
    with log_path.open("ab") as log:
        child = subprocess.Popen(
            [str(python), str(root / "render_daemon.py"), "--runtime-dir", str(runtime_dir), "--repo-root", str(root)],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=daemon_environment(),
            close_fds=True,
            creationflags=creationflags,
        )
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        state = read_render_state(runtime_dir)
        if state and float(state.get("started_at", 0)) >= launched_at - 1 and render_state_healthy(state, python, checkpoint_dir):
            return {**state, "reused_process": False, "runtime_dir": str(runtime_dir)}
        if child.poll() is not None:
            raise RuntimeError(f"IndexTTS Render Runtime 启动失败，退出码 {child.returncode}，请检查 {log_path}")
        time.sleep(0.1)
    raise TimeoutError(f"IndexTTS Render Runtime 在 {timeout_seconds:g} 秒内没有就绪")


def enqueue_render_request(runtime_dir: Path, input_path: Path, result_path: Path, status_path: Path) -> tuple[str, Path]:
    request_id = uuid.uuid4().hex
    requests_dir = runtime_dir.resolve() / "requests"
    requests_dir.mkdir(parents=True, exist_ok=True)
    request_path = requests_dir / f"{request_id}.json"
    temporary = request_path.with_suffix(".json.tmp")
    payload = {
        "protocol": PROTOCOL_VERSION,
        "request_id": request_id,
        "input": str(input_path.resolve()),
        "result": str(result_path.resolve()),
        "status": str(status_path.resolve()),
        "submitted_at": time.time(),
    }
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, request_path)
    return request_id, request_path


def release_render_model(root: Path, timeout_seconds: float = 30) -> dict[str, Any]:
    runtime_dir = root.resolve() / "runtime-output" / "render-runtime"
    state = read_render_state(runtime_dir)
    if state is None:
        return {"runtime_available": False, "released": False}
    if not state.get("model_loaded"):
        return {"runtime_available": True, "released": False, "pid": state.get("pid")}
    request_id = uuid.uuid4().hex
    request_path = runtime_dir / "release.request"
    temporary = runtime_dir / "release.request.tmp"
    response_path = runtime_dir / "release-response.json"
    temporary.write_text(json.dumps({"protocol": PROTOCOL_VERSION, "request_id": request_id}), encoding="utf-8")
    os.replace(temporary, request_path)
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        current = read_render_state(runtime_dir)
        if current is None:
            raise RuntimeError("IndexTTS Render Runtime 在释放模型时退出")
        try:
            response = json.loads(response_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            response = None
        if response and response.get("request_id") == request_id:
            if response.get("error"):
                raise RuntimeError(f"IndexTTS 模型释放失败：{response['error']}")
            return {"runtime_available": True, "released": bool(response.get("released")), "pid": current.get("pid")}
        time.sleep(0.1)
    raise TimeoutError(f"IndexTTS 模型在 {timeout_seconds:g} 秒内没有释放")
