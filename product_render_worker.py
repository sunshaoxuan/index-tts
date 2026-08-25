from __future__ import annotations

import argparse
import json
import os
import threading
from pathlib import Path
from typing import Any

from voice_design_daemon_client import release_voice_design_model


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--status", required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.input).read_text(encoding="utf-8"))
    root = Path(request["root"]).resolve()
    status_path = Path(args.status).resolve()
    result_path = Path(args.result).resolve()
    torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio = prepare_render_environment(root, status_path)
    store = NovelProjectStore(root / "outputs" / "novel-projects", root / "outputs" / "voice-library")
    project = store.load(request["project_id"])
    model_dir = root / "checkpoints"
    write_json(status_path, {"phase": "loading", "fraction": 0.02, "message": "正在加载 IndexTTS 2.5"})
    model = IndexTTS2(
        cfg_path=str(model_dir / "config.yaml"), model_dir=str(model_dir),
        use_bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        use_cuda_kernel=False, use_deepspeed=False, use_accel=False,
        use_torch_compile=False, use_qwen_emo=True,
    )
    def progress(fraction: float, desc: str = "", description: str = "") -> None:
        write_json(status_path, {"phase": "rendering", "fraction": fraction, "message": desc or description})
    master, package, manifest, summary = render_directed_audio(
        document=project.get("document") or {"title": project.get("title", "小说工程")},
        role_table=project["roles"], segment_table=project["segments"],
        pronunciation_table=pronunciation_rows(project.get("pronunciations")),
        uploaded_files=project.get("voice_files") or [], model=model, model_lock=threading.Lock(),
        output_root=store.project_dir(project["project_id"]) / "renders",
        project_process_dir=store.project_dir(project["project_id"]) / "process",
        demo_dir=root / "examples",
        demo_voices={path.name: path.name for path in (root / "examples").glob("voice_*.wav")},
        progress=progress,
    )
    result = {"master": master, "package": package, "manifest": manifest, "summary": summary}
    write_json(result_path, result)
    write_json(status_path, {"phase": "complete", "fraction": 1.0, "message": "完整音频与分轨交付已经生成"})
    return 0


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
