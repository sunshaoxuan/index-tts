from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from novel_project import NovelProjectStore, pronunciation_rows
from text_director import DirectorConfig, OllamaTextDirector, document_to_tables


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
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    root = Path(payload["root"]).resolve()
    status_path = Path(args.status).resolve()
    store = NovelProjectStore(root / "outputs" / "novel-projects", root / "outputs" / "voice-library")
    project = store.load(payload["project_id"])
    director = OllamaTextDirector(DirectorConfig(**payload["config"]))
    write_json(status_path, {"phase": "connecting", "fraction": 0.01, "message": "正在连接本地 AI"})
    director.health_summary()
    def progress(fraction: float, desc: str = "", description: str = "") -> None:
        write_json(status_path, {"phase": "analyzing", "fraction": fraction, "message": desc or description})
    document = director.analyze_document(project["source_text"], content_type=project["content_type"], guidance=project.get("guidance", ""), progress=progress)
    roles, segments = document_to_tables(document, [path.name for path in (root / "examples").glob("voice_*.wav")])
    write_json(status_path, {"phase": "routing_guidance", "fraction": 0.98, "message": "正在用 AI 分配导演补充的角色影响范围"})
    document["guidance_routing"] = director.resolve_guidance(project.get("guidance", ""), roles)
    store.save(
        project["project_id"], title=project["title"], content_type=document["content_type"],
        source_text=project["source_text"], guidance=project.get("guidance", ""), document=document,
        roles=roles, segments=segments, pronunciations=pronunciation_rows(project.get("pronunciations")),
        voice_files=project.get("voice_files") or [],
    )
    result = {"document": document, "roles": roles, "segments": segments, "guidance_routing": document["guidance_routing"]}
    write_json(Path(args.result).resolve(), result)
    write_json(status_path, {"phase": "complete", "fraction": 1.0, "message": "AI 文本导演完成"})
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
