from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from text_director import age_voice_constraint, gender_voice_identity_constraint
from voice_controls import normalize_voice_generation
from voice_design_daemon_client import enqueue_voice_design_request, ensure_voice_design_daemon, process_alive, read_runtime_state


AUDITION_TEXT = "今天的风很轻，我会慢慢讲清楚这个故事，也会认真回答你的问题。"


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def voice_job(gender: str, pitch: int, seed: int, candidate_count: int) -> dict[str, object]:
    label = "三十五岁女性" if gender == "female" else "三十五岁男性"
    return {
        "role_id": f"gender-{gender}-35",
        "name": label,
        "filename": f"gender-{gender}-35.wav",
        "text": AUDITION_TEXT,
        "language": "Chinese",
        "instruct": (
            f"{gender_voice_identity_constraint(gender, 35)}"
            f"{age_voice_constraint(35)}"
            f"目标基频中位数约 {pitch} Hz。保持自然发声，避免电子变调。"
            "吐字清晰，干声，无背景音乐，无环境噪声。"
            f"最终确认：输出必须保持自然、明确、可听辨的{'女性' if gender == 'female' else '男性'}声音。"
        ),
        "expected_gender": gender,
        "character_age": 35,
        "pitch_target_hz": pitch,
        "voice_generation": normalize_voice_generation({"preset": "stable", "candidate_count": candidate_count, "seed": seed}),
        "seed": seed,
    }


def median_pitch(path: Path) -> float | None:
    audio, sample_rate = sf.read(path, dtype="float32")
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    pitches = librosa.yin(samples, fmin=65, fmax=400, sr=sample_rate)
    rms = librosa.feature.rms(y=samples)[0]
    count = min(len(pitches), len(rms))
    voiced = pitches[:count][(rms[:count] > max(0.005, float(np.percentile(rms[:count], 35)))) & np.isfinite(pitches[:count])]
    return round(float(np.median(voiced)), 2) if voiced.size >= 6 else None


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Generate and validate paired adult female and male VoiceDesign samples")
    parser.add_argument("--repo-root", default=str(REPO_ROOT))
    parser.add_argument("--output", required=True)
    parser.add_argument("--candidate-count", type=int, default=2)
    args = parser.parse_args()
    root = Path(args.repo_root).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    candidate_count = max(1, min(3, int(args.candidate_count)))
    runtime = ensure_voice_design_daemon(root, root / ".venv-voice-design" / "Scripts" / "python.exe")
    runtime_dir = Path(runtime["runtime_dir"])
    jobs = [voice_job("female", 230, 420, candidate_count), voice_job("male", 133, 520, candidate_count)]
    with tempfile.TemporaryDirectory(dir=output) as temporary:
        temp = Path(temporary)
        input_path, result_path, status_path = temp / "input.json", temp / "result.json", temp / "status.json"
        write_json(input_path, {"jobs": jobs, "output_dir": str(output), "model_dir": str(root / "checkpoints" / "Qwen3-TTS-12Hz-1.7B-VoiceDesign")})
        request_id, _ = enqueue_voice_design_request(runtime_dir, input_path, result_path, status_path)
        deadline = time.monotonic() + 1800
        last_signature = None
        while True:
            if status_path.is_file():
                status = json.loads(status_path.read_text(encoding="utf-8"))
                signature = (status.get("phase"), status.get("message"))
                if signature != last_signature:
                    print(f"{status.get('phase')} {status.get('fraction')} {status.get('message')}", flush=True)
                    last_signature = signature
                if status.get("phase") == "error":
                    raise RuntimeError(str(status.get("message")))
                if status.get("phase") == "complete":
                    break
            state = read_runtime_state(runtime_dir)
            if not state or not process_alive(state.get("pid")):
                raise RuntimeError(f"VoiceDesign Runtime 在性别测试请求 {request_id} 期间退出")
            if time.monotonic() >= deadline:
                raise TimeoutError("性别差异测试超过 1800 秒")
            time.sleep(1)
        result = json.loads(result_path.read_text(encoding="utf-8"))

    rows = []
    for item in result["generated"]:
        path = Path(item["path"])
        valid_metrics = [metric for metric in item.get("candidate_metrics") or [] if metric.get("gender_matched")]
        rows.append({
            "role_id": item["role_id"],
            "path": str(path),
            "median_pitch_hz": median_pitch(path),
            "requested_candidate_count": item.get("requested_candidate_count"),
            "valid_candidate_count": item.get("valid_candidate_count"),
            "generation_attempts": item.get("generation_attempts"),
            "valid_candidate_paths": [metric["path"] for metric in valid_metrics],
            "candidate_metrics": item.get("candidate_metrics") or [],
        })
    by_id = {row["role_id"]: row for row in rows}
    female, male = by_id["gender-female-35"], by_id["gender-male-35"]
    checks = {
        "female_candidates_verified": female["valid_candidate_count"] == candidate_count,
        "male_candidates_verified": male["valid_candidate_count"] == candidate_count,
        "female_pitch_above_gate": female["median_pitch_hz"] is not None and female["median_pitch_hz"] >= 205,
        "female_pitch_distinct_from_male": female["median_pitch_hz"] is not None and male["median_pitch_hz"] is not None and female["median_pitch_hz"] >= male["median_pitch_hz"] + 45,
        "selected_outputs_exist": all(Path(row["path"]).is_file() for row in rows),
    }
    report = {
        "audition_text": AUDITION_TEXT,
        "runtime_pid": result.get("runtime_pid"),
        "model_reused": result.get("model_reused"),
        "rows": rows,
        "checks": checks,
        "passed": all(checks.values()),
        "limitation": "基频和候选门禁用于发现明显交叉性别样本，最终自然度与性别听感仍需人工试听确认。",
    }
    write_json(output / "gender-distinctiveness-report.json", report)
    lines = ["# 性别声音差异验证", "", f"试听文本：{AUDITION_TEXT}", "", "| 角色 | 中位基频 Hz | 合格候选 | 尝试次数 |", "|---|---:|---:|---:|"]
    lines.extend(f"| {row['role_id']} | {row['median_pitch_hz']} | {row['valid_candidate_count']} | {row['generation_attempts']} |" for row in rows)
    lines.extend(["", "## 自动检查", "", *(f"1. {name}: {'通过' if passed else '未通过'}" for name, passed in checks.items()), "", report["limitation"]])
    (output / "GENDER_DISTINCTIVENESS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
