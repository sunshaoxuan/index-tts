from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from product_render_worker import RenderRuntime, execute_render_request, write_json
from render_daemon_client import PROTOCOL_VERSION, render_source_fingerprint


VOICE_DESIGN_MODEL_DIR = "Qwen3-TTS-12Hz-1.7B-VoiceDesign"


def _checkpoint_bytes(checkpoint_dir: Path) -> int:
    total = 0
    for path in checkpoint_dir.rglob("*"):
        if path.is_file() and VOICE_DESIGN_MODEL_DIR not in path.relative_to(checkpoint_dir).parts:
            total += path.stat().st_size
    return total


def _environment(repo_root: Path) -> dict[str, Any]:
    spec = importlib.util.find_spec("indextts")
    checkpoint_dir = (repo_root / "checkpoints").resolve()
    required = [checkpoint_dir / "config.yaml", checkpoint_dir / "gpt.pth", checkpoint_dir / "s2mel.pth", checkpoint_dir / "codec.pth"]
    missing = [str(path) for path in required if not path.is_file()]
    return {
        "python_executable": str(Path(sys.executable).resolve()),
        "python_prefix": str(Path(sys.prefix).resolve()),
        "indextts_available": spec is not None,
        "indextts_origin": str(Path(spec.origin).resolve()) if spec and spec.origin else None,
        "checkpoint_dir": str(checkpoint_dir),
        "checkpoint_files_ready": not missing,
        "missing_checkpoint_paths": missing,
        "model_bytes": _checkpoint_bytes(checkpoint_dir),
        "runtime_healthy": spec is not None and not missing,
        "source_fingerprint": render_source_fingerprint(repo_root),
    }


def _state(runtime: RenderRuntime, started_at: float, environment: dict[str, Any], retained: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_VERSION,
        "pid": os.getpid(),
        "phase": "ready",
        "model_loaded": runtime.model is not None,
        "started_at": started_at,
        "updated_at": time.time(),
        **environment,
        **retained,
        **extra,
    }


def _within(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Render Runtime 请求路径超出工程目录：{resolved}") from exc
    return resolved


def serve(runtime_dir: Path, repo_root: Path) -> int:
    runtime_dir, repo_root = runtime_dir.resolve(), repo_root.resolve()
    requests_dir = runtime_dir / "requests"
    requests_dir.mkdir(parents=True, exist_ok=True)
    state_path = runtime_dir / "state.json"
    stop_path = runtime_dir / "stop.request"
    release_path = runtime_dir / "release.request"
    release_response_path = runtime_dir / "release-response.json"
    runtime = RenderRuntime()
    environment = _environment(repo_root)
    retained: dict[str, Any] = {}
    started_at = time.time()
    write_json(state_path, _state(runtime, started_at, environment, retained))
    last_heartbeat = 0.0
    while True:
        if stop_path.exists():
            stop_path.unlink(missing_ok=True)
            runtime.release()
            write_json(state_path, _state(runtime, started_at, environment, retained, phase="stopped"))
            return 0
        if release_path.exists():
            request_id = "unknown"
            try:
                request_id = str(json.loads(release_path.read_text(encoding="utf-8"))["request_id"])
                write_json(state_path, _state(runtime, started_at, environment, retained, phase="releasing"))
                released = runtime.release()
                write_json(release_response_path, {"protocol": PROTOCOL_VERSION, "request_id": request_id, "released": released})
                retained.update(last_release_id=request_id, last_release_at=time.time())
                write_json(state_path, _state(runtime, started_at, environment, retained))
            except Exception as exc:
                write_json(release_response_path, {"protocol": PROTOCOL_VERSION, "request_id": request_id, "error": str(exc)})
                retained.update(last_release_id=request_id, last_release_error=str(exc))
                write_json(state_path, _state(runtime, started_at, environment, retained))
            finally:
                release_path.unlink(missing_ok=True)
            continue
        requests = sorted(requests_dir.glob("*.json"), key=lambda path: path.stat().st_mtime_ns)
        if not requests:
            if time.time() - last_heartbeat >= 5:
                write_json(state_path, _state(runtime, started_at, environment, retained))
                last_heartbeat = time.time()
            time.sleep(0.1)
            continue
        request_file = requests[0]
        processing_file = request_file.with_suffix(".processing")
        status_path: Path | None = None
        try:
            os.replace(request_file, processing_file)
            envelope = json.loads(processing_file.read_text(encoding="utf-8"))
            if int(envelope.get("protocol", 0)) != PROTOCOL_VERSION:
                raise ValueError("IndexTTS Render Runtime 协议版本不一致")
            input_path = _within(Path(envelope["input"]), repo_root)
            result_path = _within(Path(envelope["result"]), repo_root)
            status_path = _within(Path(envelope["status"]), repo_root)
            write_json(state_path, _state(runtime, started_at, environment, retained, phase="busy", request_id=envelope["request_id"]))
            request = json.loads(input_path.read_text(encoding="utf-8"))
            execute_render_request(request, result_path, status_path, runtime)
            retained.update(last_request_id=envelope["request_id"], last_used_at=time.time())
            retained.pop("last_error", None)
            retained.pop("last_error_type", None)
            write_json(state_path, _state(runtime, started_at, environment, retained))
        except Exception as exc:
            if status_path is not None:
                write_json(status_path, {"phase": "error", "fraction": 1.0, "message": str(exc)})
            retained.update(last_error=str(exc), last_error_type=type(exc).__name__)
            write_json(state_path, _state(runtime, started_at, environment, retained))
        finally:
            processing_file.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-dir", required=True)
    parser.add_argument("--repo-root", required=True)
    args = parser.parse_args()
    return serve(Path(args.runtime_dir), Path(args.repo_root))


if __name__ == "__main__":
    raise SystemExit(main())
