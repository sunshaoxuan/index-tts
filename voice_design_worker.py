from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any


def estimate_median_pitch(wav: Any, sample_rate: int) -> float | None:
    import librosa
    import numpy as np

    samples = np.asarray(wav, dtype=np.float32).reshape(-1)
    if samples.size < 2048 or float(np.max(np.abs(samples))) < 0.005:
        return None
    pitches = librosa.yin(samples, fmin=65, fmax=400, sr=sample_rate)
    rms = librosa.feature.rms(y=samples, frame_length=2048, hop_length=512)[0]
    count = min(len(pitches), len(rms))
    floor = max(0.005, float(np.percentile(rms[:count], 35)))
    voiced = pitches[:count][(rms[:count] > floor) & np.isfinite(pitches[:count])]
    if voiced.size < 6:
        return None
    return round(float(np.median(voiced)), 2)


def gender_pitch_matches(expected_gender: str, median_pitch: float | None) -> bool:
    if expected_gender == "female":
        return median_pitch is not None and median_pitch >= 135
    if expected_gender == "male":
        return median_pitch is not None and median_pitch <= 210
    return True


def gender_pitch_score(expected_gender: str, median_pitch: float | None) -> float:
    if median_pitch is None:
        return float("-inf")
    if expected_gender == "female":
        return median_pitch
    if expected_gender == "male":
        return -median_pitch
    return 0.0


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
        expected_gender = str(job.get("expected_gender") or "unspecified")
        max_attempts = int(payload.get("gender_max_attempts", 3)) if expected_gender in {"female", "male"} else 1
        best_wav, best_sample_rate, best_pitch, best_score, attempts_used = None, None, None, float("-inf"), 0
        for attempt in range(max_attempts):
            candidate_seed = job_seed + attempt
            torch.manual_seed(candidate_seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(candidate_seed)
            if attempt:
                _write_json(
                    status_path,
                    {
                        "phase": "gender_retry",
                        "fraction": 0.08 + 0.86 * (index - 0.5) / len(jobs),
                        "message": f"{job['name']} 音色性别校验未通过，正在重试 {attempt + 1}/{max_attempts}",
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
            median_pitch = estimate_median_pitch(wavs[0], sample_rate) if expected_gender in {"female", "male"} else None
            score = gender_pitch_score(expected_gender, median_pitch)
            if best_wav is None or score > best_score:
                best_wav, best_sample_rate, best_pitch, best_score = wavs[0], sample_rate, median_pitch, score
            attempts_used = attempt + 1
            if gender_pitch_matches(expected_gender, median_pitch):
                break
        if expected_gender in {"female", "male"} and not gender_pitch_matches(expected_gender, best_pitch):
            label = "女性" if expected_gender == "female" else "男性"
            measured = "无法测量" if best_pitch is None else f"{best_pitch:.1f} Hz"
            raise ValueError(f"{job['name']} 要求{label}音色，连续 {attempts_used} 次生成均未通过声学性别校验，最佳基频中位数为 {measured}。")
        output_path = output_dir / str(job["filename"])
        sf.write(output_path, best_wav, best_sample_rate)
        generated.append(
            {
                "role_id": str(job["role_id"]),
                "name": str(job["name"]),
                "path": str(output_path),
                "expected_gender": expected_gender,
                "median_pitch_hz": best_pitch,
                "generation_attempts": attempts_used,
            }
        )

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
