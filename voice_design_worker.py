from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate reusable role references with Qwen3-TTS VoiceDesign")
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
    jobs = payload.get("jobs") or []
    if not jobs:
        raise ValueError("没有需要生成的角色音色。")

    output_dir = Path(payload["output_dir"]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(status_path, {"phase": "loading", "fraction": 0.02, "message": "正在加载 Qwen3-TTS VoiceDesign"})

    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    torch.manual_seed(int(payload.get("seed", 42)))
    torch.set_float32_matmul_precision("high")
    model = Qwen3TTSModel.from_pretrained(
        str(Path(payload["model_dir"]).resolve()),
        device_map="cuda:0",
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )

    generated: list[dict[str, str]] = []
    started = time.perf_counter()
    for index, job in enumerate(jobs, start=1):
        job_seed = int(job.get("seed", payload.get("seed", 42)))
        torch.manual_seed(job_seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(job_seed)
        _write_json(
            status_path,
            {
                "phase": "generating",
                "fraction": 0.08 + 0.86 * (index - 1) / len(jobs),
                "message": f"正在设计角色音色 {index}/{len(jobs)}：{job['name']}",
            },
        )
        wavs, sample_rate = model.generate_voice_design(
            text=str(job["text"]),
            language=str(job.get("language") or "Auto"),
            instruct=str(job["instruct"]),
            do_sample=True,
            temperature=float(payload.get("temperature", 0.8)),
            top_p=float(payload.get("top_p", 0.9)),
            repetition_penalty=float(payload.get("repetition_penalty", 1.05)),
            max_new_tokens=int(payload.get("max_new_tokens", 1024)),
        )
        output_path = output_dir / str(job["filename"])
        sf.write(output_path, wavs[0], sample_rate)
        generated.append({"role_id": str(job["role_id"]), "name": str(job["name"]), "path": str(output_path)})

    _write_json(
        result_path,
        {
            "generated": generated,
            "model": str(payload["model_dir"]),
            "duration_seconds": round(time.perf_counter() - started, 3),
        },
    )
    _write_json(status_path, {"phase": "complete", "fraction": 1.0, "message": "角色音色设计完成"})
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
