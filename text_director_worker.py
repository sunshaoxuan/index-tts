from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from text_director import DirectorConfig, OllamaTextDirector


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cancelable Ollama text director worker")
    parser.add_argument("--input", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--status", required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    input_path = Path(args.input).resolve()
    result_path = Path(args.result).resolve()
    status_path = Path(args.status).resolve()
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    config = DirectorConfig(**payload["config"])
    director = OllamaTextDirector(config)

    _write_json(status_path, {"phase": "connecting", "fraction": 0.01, "message": "正在连接本地 AI"})
    director.health_summary()

    def progress(fraction: float, desc: str = "", description: str = "") -> None:
        message = desc or description or "正在分析文本"
        _write_json(
            status_path,
            {"phase": "analyzing", "fraction": max(0.02, min(0.98, float(fraction))), "message": message},
        )

    document = director.analyze_document(
        str(payload["source_text"]),
        content_type=str(payload.get("content_type", "auto")),
        guidance=str(payload.get("guidance", "")),
        progress=progress,
    )
    _write_json(result_path, document)
    _write_json(status_path, {"phase": "complete", "fraction": 1.0, "message": "AI 文本导演完成"})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        try:
            parsed = _parse_args()
            _write_json(
                Path(parsed.status).resolve(),
                {"phase": "error", "fraction": 1.0, "message": str(exc), "error_type": type(exc).__name__},
            )
        except Exception:
            pass
        raise
