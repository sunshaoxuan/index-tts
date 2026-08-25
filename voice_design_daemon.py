from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

from voice_design_worker import VoiceDesignRuntime, _write_json, generate_voice_design

PROTOCOL_VERSION = 1


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Persistent Qwen3-TTS VoiceDesign runtime")
    parser.add_argument("--runtime-dir", required=True)
    parser.add_argument("--repo-root", required=True)
    return parser.parse_args()


def _within(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"VoiceDesign 请求路径超出工程目录：{resolved}") from exc
    return resolved


def _state_payload(runtime: VoiceDesignRuntime, started_at: float, **extra: Any) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_VERSION,
        "pid": os.getpid(),
        "phase": "ready",
        "model_loaded": runtime.model is not None,
        "model_dir": str(runtime.model_dir) if runtime.model_dir else None,
        "started_at": started_at,
        "updated_at": time.time(),
        **extra,
    }


def serve(runtime_dir: Path, repo_root: Path) -> int:
    runtime_dir = runtime_dir.resolve()
    repo_root = repo_root.resolve()
    requests_dir = runtime_dir / "requests"
    requests_dir.mkdir(parents=True, exist_ok=True)
    state_path = runtime_dir / "state.json"
    stop_path = runtime_dir / "stop.request"
    release_path = runtime_dir / "release.request"
    release_response_path = runtime_dir / "release-response.json"
    runtime = VoiceDesignRuntime()
    started_at = time.time()
    _write_json(state_path, _state_payload(runtime, started_at))
    last_heartbeat = 0.0

    while True:
        if stop_path.exists():
            stop_path.unlink(missing_ok=True)
            _write_json(state_path, _state_payload(runtime, started_at, phase="stopped"))
            return 0

        if release_path.exists():
            request_id = "unknown"
            try:
                envelope = json.loads(release_path.read_text(encoding="utf-8"))
                request_id = str(envelope["request_id"])
                _write_json(state_path, _state_payload(runtime, started_at, phase="releasing", release_request_id=request_id))
                released = runtime.release()
                completed_at = time.time()
                _write_json(
                    release_response_path,
                    {"protocol": PROTOCOL_VERSION, "request_id": request_id, "released": released, "completed_at": completed_at},
                )
                _write_json(state_path, _state_payload(runtime, started_at, last_release_id=request_id, last_release_at=completed_at))
            except Exception as exc:
                _write_json(
                    release_response_path,
                    {"protocol": PROTOCOL_VERSION, "request_id": request_id, "error": str(exc), "completed_at": time.time()},
                )
                _write_json(state_path, _state_payload(runtime, started_at, last_release_id=request_id, last_release_error=str(exc)))
            finally:
                release_path.unlink(missing_ok=True)
            continue

        request_files = sorted(requests_dir.glob("*.json"), key=lambda item: item.stat().st_mtime_ns)
        if not request_files:
            if time.time() - last_heartbeat >= 5:
                _write_json(state_path, _state_payload(runtime, started_at))
                last_heartbeat = time.time()
            time.sleep(0.1)
            continue

        request_file = request_files[0]
        processing_file = request_file.with_suffix(".processing")
        status_path: Path | None = None
        try:
            os.replace(request_file, processing_file)
            envelope = json.loads(processing_file.read_text(encoding="utf-8"))
            if int(envelope.get("protocol", 0)) != PROTOCOL_VERSION:
                raise ValueError("VoiceDesign Runtime 协议版本不一致")
            input_path = _within(Path(envelope["input"]), repo_root)
            result_path = _within(Path(envelope["result"]), repo_root)
            status_path = _within(Path(envelope["status"]), repo_root)
            payload = json.loads(input_path.read_text(encoding="utf-8"))
            _write_json(state_path, _state_payload(runtime, started_at, phase="busy", request_id=envelope["request_id"]))
            generate_voice_design(payload, result_path, status_path, runtime)
            _write_json(state_path, _state_payload(runtime, started_at, last_request_id=envelope["request_id"], last_used_at=time.time()))
        except Exception as exc:
            try:
                if status_path is not None:
                    _write_json(status_path, {"phase": "error", "fraction": 1.0, "message": str(exc), "error_type": type(exc).__name__})
            finally:
                _write_json(state_path, _state_payload(runtime, started_at, phase="ready", last_error=str(exc)))
        finally:
            processing_file.unlink(missing_ok=True)


def main() -> int:
    args = _parse_args()
    return serve(Path(args.runtime_dir), Path(args.repo_root))


if __name__ == "__main__":
    raise SystemExit(main())
