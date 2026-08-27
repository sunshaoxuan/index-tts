from __future__ import annotations

import argparse
import gc
import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from voice_design_daemon_client import release_voice_design_model
from render_daemon_client import enqueue_render_request, ensure_render_daemon, read_render_state
from voice_design_daemon_client import process_alive
from runtime_python import main_python


MIN_AVAILABLE_MEMORY_BYTES = 2 * 1024**3


def write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def available_memory_bytes() -> int | None:
    if os.name == "nt":
        import ctypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("length", ctypes.c_ulong),
                ("memory_load", ctypes.c_ulong),
                ("total_physical", ctypes.c_ulonglong),
                ("available_physical", ctypes.c_ulonglong),
                ("total_page_file", ctypes.c_ulonglong),
                ("available_page_file", ctypes.c_ulonglong),
                ("total_virtual", ctypes.c_ulonglong),
                ("available_virtual", ctypes.c_ulonglong),
                ("available_extended_virtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatus()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.available_physical)
        return None
    try:
        return int(os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"))
    except (AttributeError, OSError, ValueError):
        return None


def _load_render_dependencies() -> tuple[Any, Any, Any, Any, Any]:
    import torch
    from indextts.infer_v2_5 import IndexTTS2
    from novel_project import NovelProjectStore, pronunciation_rows
    from text_director import render_directed_audio

    return torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio


def prepare_render_environment(root: Path, status_path: Path) -> tuple[Any, Any, Any, Any, Any]:
    write_json(status_path, {"phase": "preparing", "fraction": 0.005, "message": "正在释放音色设计模型，为完整渲染准备内存"})
    release_voice_design_model(root)
    available = available_memory_bytes()
    if available is not None and available < MIN_AVAILABLE_MEMORY_BYTES:
        available_gib = available / 1024**3
        raise RuntimeError(f"完整渲染可用内存不足：当前 {available_gib:.1f} GiB，至少需要 2.0 GiB，请先释放主机内存后重试")
    write_json(status_path, {"phase": "importing", "fraction": 0.01, "message": "正在加载 PyTorch CUDA 运行库"})
    return _load_render_dependencies()


class RenderRuntime:
    def __init__(self) -> None:
        self.dependencies: tuple[Any, Any, Any, Any, Any] | None = None
        self.model: Any | None = None
        self.torch: Any | None = None
        self.model_lock = threading.Lock()

    def release(self) -> bool:
        had_model = self.model is not None
        torch = self.torch
        self.model = None
        gc.collect()
        if torch is not None:
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
            except Exception:
                pass
        return had_model

    def get_model(self, root: Path, status_path: Path) -> tuple[Any, Any, Any, Any, Any, Any, bool]:
        if self.model is not None and self.dependencies is not None:
            write_json(status_path, {"phase": "model_ready", "fraction": 0.02, "message": "正在复用已驻留的 IndexTTS 2.5"})
            torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio = self.dependencies
            return torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio, self.model, True
        if self.dependencies is None:
            self.dependencies = prepare_render_environment(root, status_path)
        else:
            write_json(status_path, {"phase": "preparing", "fraction": 0.005, "message": "正在释放音色设计模型，为合成模型准备内存"})
            release_voice_design_model(root)
            available = available_memory_bytes()
            if available is not None and available < MIN_AVAILABLE_MEMORY_BYTES:
                raise RuntimeError(f"合成模型可用内存不足：当前 {available / 1024**3:.1f} GiB，至少需要 2.0 GiB")
        torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio = self.dependencies
        model_dir = root / "checkpoints"
        write_json(status_path, {"phase": "loading", "fraction": 0.02, "message": "正在加载 IndexTTS 2.5"})
        self.model = IndexTTS2(
            cfg_path=str(model_dir / "config.yaml"), model_dir=str(model_dir),
            use_bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
            use_cuda_kernel=False, use_deepspeed=False, use_accel=False,
            use_torch_compile=False, use_qwen_emo=True,
        )
        self.torch = torch
        return torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio, self.model, False


def execute_render_request(request: dict[str, Any], result_path: Path, status_path: Path, runtime: RenderRuntime | None = None) -> dict[str, Any]:
    root = Path(request["root"]).resolve()
    cache_only = bool(request.get("cache_only"))
    if cache_only:
        from novel_project import NovelProjectStore, pronunciation_rows
        from text_director import render_directed_audio

        torch = IndexTTS2 = None
        model_reused = False
        write_json(status_path, {"phase": "assembling", "fraction": 0.01, "message": "正在校验并串接全部已生成片断"})
    else:
        runtime = runtime or RenderRuntime()
        torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio, model, model_reused = runtime.get_model(root, status_path)
    store = NovelProjectStore(root / "outputs" / "novel-projects", root / "outputs" / "voice-library")
    project = store.load(request["project_id"])
    if cache_only:
        model = object()
    def progress(fraction: float, desc: str = "", description: str = "") -> None:
        write_json(status_path, {"phase": "rendering", "fraction": fraction, "message": desc or description})
    master, package, manifest, summary = render_directed_audio(
        document=project.get("document") or {"title": project.get("title", "小说工程")},
        role_table=project["roles"], segment_table=project["segments"],
        pronunciation_table=pronunciation_rows(project.get("pronunciations")),
        uploaded_files=project.get("voice_files") or [], model=model, model_lock=runtime.model_lock if runtime else threading.Lock(),
        output_root=store.project_dir(project["project_id"]) / "renders",
        project_process_dir=store.project_dir(project["project_id"]) / "process",
        force_segment_orders=request.get("force_segment_orders") or [],
        fragment_only_orders=request.get("fragment_only_orders") or [],
        cache_only=cache_only,
        demo_dir=root / "examples",
        demo_voices={path.name: path.name for path in (root / "examples").glob("voice_*.wav")},
        voice_library_dir=root / "outputs" / "voice-library",
        progress=progress,
    )
    result = {"master": master, "package": package, "manifest": manifest, "summary": summary, "render_runtime": {"model_reused": model_reused, "resident": not cache_only, "pid": os.getpid()}}
    write_json(result_path, result)
    if request.get("fragment_only_orders"):
        reuse_message = "，已复用驻留模型" if model_reused else "，合成模型已保持驻留"
        complete_message = f"分句 {request['fragment_only_orders'][0]} 已重新生成，其他分句保持不变{reuse_message}"
    else:
        complete_message = "已使用全部已有片断串接完整音频" if cache_only else "完整音频与分轨交付已经生成"
    write_json(status_path, {"phase": "complete", "fraction": 1.0, "message": complete_message})
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--status", required=True)
    args = parser.parse_args()
    input_path = Path(args.input).resolve()
    result_path = Path(args.result).resolve()
    status_path = Path(args.status).resolve()
    request = json.loads(input_path.read_text(encoding="utf-8"))
    root = Path(request["root"]).resolve()
    if request.get("cache_only"):
        execute_render_request(request, result_path, status_path, RenderRuntime())
        return 0
    python = main_python(root)
    runtime = ensure_render_daemon(root, python)
    warm = bool(runtime.get("model_loaded"))
    write_json(status_path, {"phase": "model_ready" if warm else "runtime_ready", "fraction": 0.01, "message": "正在复用已驻留的 IndexTTS 2.5" if warm else "IndexTTS 持久运行时已就绪，正在首次加载模型"})
    request_id, _ = enqueue_render_request(Path(runtime["runtime_dir"]), input_path, result_path, status_path)
    deadline = time.monotonic() + 7200
    while True:
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            status = {}
        if status.get("phase") in {"complete", "error"}:
            if status.get("phase") == "error":
                raise RuntimeError(str(status.get("message") or "IndexTTS Render Runtime 请求失败"))
            return 0
        state = read_render_state(Path(runtime["runtime_dir"]))
        if not state or not process_alive(state.get("pid")):
            raise RuntimeError(f"IndexTTS Render Runtime 在请求 {request_id} 期间退出")
        if time.monotonic() >= deadline:
            raise TimeoutError(f"IndexTTS Render Runtime 请求 {request_id} 超过 7200 秒")
        time.sleep(0.5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        try:
            parsed = argparse.ArgumentParser(add_help=False)
            parsed.add_argument("--status")
            known, _ = parsed.parse_known_args()
            if known.status:
                write_json(Path(known.status), {"phase": "error", "fraction": 1.0, "message": str(exc)})
        except Exception:
            pass
        raise
