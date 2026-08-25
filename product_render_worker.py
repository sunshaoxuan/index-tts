from __future__ import annotations

import argparse
import json
import os
import threading
from pathlib import Path
from typing import Any

import torch

from indextts.infer_v2_5 import IndexTTS2
from novel_project import NovelProjectStore, pronunciation_rows
from text_director import render_directed_audio


def write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


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
