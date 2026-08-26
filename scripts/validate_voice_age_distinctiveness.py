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

from text_director import age_voice_constraint
from voice_controls import normalize_voice_generation, recommended_voice_traits, voice_traits_instruction
from voice_design_daemon_client import enqueue_voice_design_request, ensure_voice_design_daemon, process_alive, read_runtime_state


AUDITION_TEXT = "今天的风很轻，我会慢慢讲清楚这个故事，也会认真回答你的问题。"


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def job(age: int, role_id: str, label: str, pitch: int, seed: int) -> dict[str, object]:
    traits = recommended_voice_traits(age)
    generation = normalize_voice_generation({"preset": "stable", "candidate_count": 2, "seed": seed, "max_new_tokens": 2048})
    return {
        "role_id": role_id,
        "name": label,
        "filename": f"{role_id}.wav",
        "text": AUDITION_TEXT,
        "language": "Chinese",
        "instruct": (
            f"设计一名约 {age} 岁{'尚未变声男孩' if age < 13 else '男性'}的自然中文声音。"
            f"{age_voice_constraint(age)}"
            f"{voice_traits_instruction(traits)}"
            f"目标基频中位数约 {pitch} Hz。保持自然发声，避免电子变调。"
            "吐字清晰，干声，无背景音乐，无环境噪声。"
        ),
        "expected_gender": "male",
        "character_age": age,
        "pitch_target_hz": pitch,
        "voice_traits": traits,
        "voice_generation": generation,
        "seed": seed,
    }


def audio_metrics(path: Path) -> dict[str, float | None]:
    audio, sample_rate = sf.read(path, dtype="float32")
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    duration = len(audio) / sample_rate
    centroid = librosa.feature.spectral_centroid(y=audio, sr=sample_rate)[0]
    flatness = librosa.feature.spectral_flatness(y=audio)[0]
    rms = librosa.feature.rms(y=audio)[0]
    pitches = librosa.yin(audio, fmin=65, fmax=400, sr=sample_rate)
    count = min(len(pitches), len(rms))
    voiced = pitches[:count][(rms[:count] > max(0.005, float(np.percentile(rms[:count], 35)))) & np.isfinite(pitches[:count])]
    return {
        "duration_seconds": round(float(duration), 3),
        "median_pitch_hz": round(float(np.median(voiced)), 2) if voiced.size >= 6 else None,
        "spectral_centroid_hz": round(float(np.mean(centroid)), 2),
        "spectral_flatness": round(float(np.mean(flatness)), 5),
        "rms": round(float(np.mean(rms)), 5),
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.repo_root).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    voice_python = root / ".venv-voice-design" / "Scripts" / "python.exe"
    runtime = ensure_voice_design_daemon(root, voice_python)
    runtime_dir = Path(runtime["runtime_dir"])
    jobs = [
        job(10, "age-child-10", "十岁儿童", 230, 110),
        job(35, "age-adult-35", "三十五岁成年", 125, 210),
        job(72, "age-older-72", "七十二岁老年", 95, 310),
    ]
    with tempfile.TemporaryDirectory(dir=output) as temporary:
        temp = Path(temporary)
        input_path, result_path, status_path = temp / "input.json", temp / "result.json", temp / "status.json"
        write_json(input_path, {"jobs": jobs, "output_dir": str(output), "model_dir": str(root / "checkpoints" / "Qwen3-TTS-12Hz-1.7B-VoiceDesign")})
        request_id, _ = enqueue_voice_design_request(runtime_dir, input_path, result_path, status_path)
        deadline = time.monotonic() + 1800
        while True:
            if status_path.is_file():
                status = json.loads(status_path.read_text(encoding="utf-8"))
                print(f"{status.get('phase')} {status.get('fraction')} {status.get('message')}", flush=True)
                if status.get("phase") == "error":
                    raise RuntimeError(str(status.get("message")))
                if status.get("phase") == "complete":
                    break
            state = read_runtime_state(runtime_dir)
            if not state or not process_alive(state.get("pid")):
                raise RuntimeError(f"VoiceDesign Runtime 在年龄测试请求 {request_id} 期间退出")
            if time.monotonic() >= deadline:
                raise TimeoutError("年龄差异测试超过 1800 秒")
            time.sleep(1)
        result = json.loads(result_path.read_text(encoding="utf-8"))
    rows = []
    for item, source_job in zip(result["generated"], jobs, strict=True):
        path = Path(item["path"])
        rows.append({
            "role_id": item["role_id"], "age": source_job["character_age"], "path": str(path),
            "target_pitch_hz": source_job["pitch_target_hz"], **audio_metrics(path),
            "candidate_metrics": item.get("candidate_metrics") or [],
        })
    by_id = {row["role_id"]: row for row in rows}
    child, adult, older = by_id["age-child-10"], by_id["age-adult-35"], by_id["age-older-72"]
    checks = {
        "child_pitch_above_adult": child["median_pitch_hz"] is not None and adult["median_pitch_hz"] is not None and child["median_pitch_hz"] >= adult["median_pitch_hz"] + 20,
        "adult_pitch_above_older": adult["median_pitch_hz"] is not None and older["median_pitch_hz"] is not None and adult["median_pitch_hz"] >= older["median_pitch_hz"] + 10,
        "older_spectral_centroid_below_child": older["spectral_centroid_hz"] < child["spectral_centroid_hz"],
        "older_delivery_not_faster_than_child": older["duration_seconds"] >= child["duration_seconds"] * 0.95,
    }
    report = {"audition_text": AUDITION_TEXT, "rows": rows, "checks": checks, "passed": all(checks.values()), "limitation": "声学代理可以验证年龄方向性，最终感知年龄仍需人工试听确认。"}
    write_json(output / "age-distinctiveness-report.json", report)
    table = ["# 年龄声音差异验证", "", f"试听文本：{AUDITION_TEXT}", "", "| 年龄 | 中位基频 Hz | 频谱重心 Hz | 时长 s | 频谱平坦度 |", "|---:|---:|---:|---:|---:|"]
    table.extend(f"| {row['age']} | {row['median_pitch_hz']} | {row['spectral_centroid_hz']} | {row['duration_seconds']} | {row['spectral_flatness']} |" for row in rows)
    table.extend(["", "## 自动检查", "", *(f"1. {name}: {'通过' if passed else '未通过'}" for name, passed in checks.items()), "", report["limitation"]])
    (output / "AGE_DISTINCTIVENESS.md").write_text("\n".join(table) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
