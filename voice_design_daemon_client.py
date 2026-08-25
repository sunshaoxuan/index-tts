from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1


def _windows_process_alive(pid: int) -> bool:
    import ctypes
    from ctypes import wintypes

    process_query_limited_information = 0x1000
    still_active = 259
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    open_process = kernel32.OpenProcess
    open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    open_process.restype = wintypes.HANDLE
    get_exit_code_process = kernel32.GetExitCodeProcess
    get_exit_code_process.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    get_exit_code_process.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL

    handle = open_process(process_query_limited_information, False, pid)
    if not handle:
        return False
    try:
        exit_code = wintypes.DWORD()
        return bool(get_exit_code_process(handle, ctypes.byref(exit_code))) and exit_code.value == still_active
    finally:
        close_handle(handle)


def process_alive(pid: Any) -> bool:
    try:
        pid_value = int(pid)
        if pid_value <= 0:
            return False
        if os.name == "nt":
            return _windows_process_alive(pid_value)
        os.kill(pid_value, 0)
        return True
    except (OSError, SystemError, TypeError, ValueError):
        return False


def read_runtime_state(runtime_dir: Path) -> dict[str, Any] | None:
    try:
        state = json.loads((runtime_dir / "state.json").read_text(encoding="utf-8"))
        if int(state.get("protocol", 0)) != PROTOCOL_VERSION or not process_alive(state.get("pid")):
            return None
        return state
    except (OSError, ValueError, TypeError):
        return None


def ensure_voice_design_daemon(root: Path, python: Path, timeout_seconds: float = 45) -> dict[str, Any]:
    root = root.resolve()
    runtime_dir = root / "runtime-output" / "voice-design-runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    state = read_runtime_state(runtime_dir)
    if state:
        return {**state, "reused_process": True, "runtime_dir": str(runtime_dir)}

    log_path = runtime_dir / "daemon.log"
    creationflags = (
        getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        | getattr(subprocess, "DETACHED_PROCESS", 0)
        | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )
    launched_at = time.time()
    with log_path.open("ab") as log:
        child = subprocess.Popen(
            [str(python), str(root / "voice_design_daemon.py"), "--runtime-dir", str(runtime_dir), "--repo-root", str(root)],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            close_fds=True,
            creationflags=creationflags,
        )
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        state = read_runtime_state(runtime_dir)
        if state and float(state.get("started_at", 0)) >= launched_at - 1:
            return {**state, "reused_process": False, "runtime_dir": str(runtime_dir)}
        if child.poll() is not None:
            raise RuntimeError(f"VoiceDesign Runtime 启动失败，退出码 {child.returncode}，请检查 {log_path}")
        time.sleep(0.1)
    raise TimeoutError(f"VoiceDesign Runtime 在 {timeout_seconds:g} 秒内没有就绪，请检查 {log_path}")


def enqueue_voice_design_request(
    runtime_dir: Path,
    input_path: Path,
    result_path: Path,
    status_path: Path,
) -> tuple[str, Path]:
    request_id = uuid.uuid4().hex
    requests_dir = runtime_dir.resolve() / "requests"
    requests_dir.mkdir(parents=True, exist_ok=True)
    request_path = requests_dir / f"{request_id}.json"
    temporary = request_path.with_suffix(".json.tmp")
    envelope = {
        "protocol": PROTOCOL_VERSION,
        "request_id": request_id,
        "input": str(input_path.resolve()),
        "result": str(result_path.resolve()),
        "status": str(status_path.resolve()),
        "submitted_at": time.time(),
    }
    temporary.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, request_path)
    return request_id, request_path
