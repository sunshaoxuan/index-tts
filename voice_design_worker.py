from __future__ import annotations

import argparse
import gc
import json
import os
import time
from pathlib import Path
from typing import Any


PITCH_CALIBRATION_VERSION = 2


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


def pitch_target_tolerance_hz(target_pitch: float) -> float:
    return round(max(3.0, min(10.0, float(target_pitch) * 0.05)), 2)


def pitch_target_matches(median_pitch: float | None, target_pitch: float | None, tolerance_hz: float | None = None) -> bool:
    if target_pitch is None:
        return True
    if median_pitch is None:
        return False
    tolerance = tolerance_hz if tolerance_hz is not None else pitch_target_tolerance_hz(target_pitch)
    return abs(float(median_pitch) - float(target_pitch)) <= float(tolerance)


def calibrate_pitch_to_target(
    wav: Any,
    sample_rate: int,
    median_pitch: float | None,
    target_pitch: float | None,
    *,
    max_semitones: float = 12.0,
) -> tuple[Any, float | None, float, bool]:
    import librosa
    import numpy as np

    samples = np.asarray(wav, dtype=np.float32).reshape(-1)
    if target_pitch is None:
        return samples, median_pitch, 0.0, True
    tolerance = pitch_target_tolerance_hz(target_pitch)
    if pitch_target_matches(median_pitch, target_pitch, tolerance):
        return samples, median_pitch, 0.0, True
    if median_pitch is None or median_pitch <= 0 or target_pitch <= 0:
        return samples, median_pitch, 0.0, False

    corrected = samples
    corrected_pitch = float(median_pitch)
    total_semitones = 0.0
    for _ in range(2):
        if pitch_target_matches(corrected_pitch, target_pitch, tolerance):
            break
        adjustment = 12.0 * float(np.log2(float(target_pitch) / corrected_pitch))
        if abs(total_semitones + adjustment) > max_semitones:
            return samples, median_pitch, 0.0, False
        corrected = librosa.effects.pitch_shift(
            corrected,
            sr=sample_rate,
            n_steps=adjustment,
            bins_per_octave=12,
            res_type="soxr_hq",
        ).astype(np.float32, copy=False)
        total_semitones += adjustment
        corrected_pitch = estimate_median_pitch(corrected, sample_rate) or 0.0
        if corrected_pitch <= 0:
            return samples, median_pitch, 0.0, False

    original_peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    corrected_peak = float(np.max(np.abs(corrected))) if corrected.size else 0.0
    if original_peak > 0 and corrected_peak > original_peak:
        corrected = corrected * (original_peak / corrected_peak)
    corrected_pitch = estimate_median_pitch(corrected, sample_rate)
    return corrected, corrected_pitch, round(total_semitones, 4), pitch_target_matches(corrected_pitch, target_pitch, tolerance)


def persist_calibrated_candidate(
    path: Path,
    wav: Any,
    sample_rate: int,
    target_pitch: float | None,
    correction_semitones: float,
    *,
    max_persisted_corrections: int = 2,
) -> tuple[Any, float | None, float, bool]:
    import soundfile as sf

    candidate_wav = wav
    total_semitones = float(correction_semitones)
    for correction_pass in range(max_persisted_corrections + 1):
        sf.write(path, candidate_wav, sample_rate)
        persisted_wav, persisted_sample_rate = sf.read(path, dtype="float32")
        persisted_pitch = estimate_median_pitch(persisted_wav, persisted_sample_rate)
        matched = pitch_target_matches(persisted_pitch, target_pitch)
        if matched or target_pitch is None or correction_pass >= max_persisted_corrections:
            return persisted_wav, persisted_pitch, round(total_semitones, 4), matched
        recalibrated, _, additional_semitones, _ = calibrate_pitch_to_target(
            persisted_wav, persisted_sample_rate, persisted_pitch, target_pitch
        )
        if not additional_semitones or abs(total_semitones + additional_semitones) > 12.0:
            return persisted_wav, persisted_pitch, round(total_semitones, 4), False
        candidate_wav = recalibrated
        total_semitones += additional_semitones
    return persisted_wav, persisted_pitch, round(total_semitones, 4), False


def gender_pitch_matches(
    expected_gender: str,
    median_pitch: float | None,
    character_age: int | None = None,
    target_pitch: float | None = None,
    pitch_min_hz: float | None = None,
    pitch_max_hz: float | None = None,
) -> bool:
    if median_pitch is None:
        return False
    if pitch_min_hz is not None and pitch_max_hz is not None and 0 < pitch_min_hz < pitch_max_hz:
        return pitch_min_hz <= median_pitch <= pitch_max_hz
    if character_age is not None and character_age < 13:
        return 130 <= median_pitch <= 360
    if character_age is not None and character_age < 20:
        if expected_gender == "female":
            floor = 185.0
            return median_pitch >= max(floor, target_pitch - 25 if target_pitch is not None else floor)
        if expected_gender == "male":
            return median_pitch <= 260
    if expected_gender == "female":
        floor = 155.0 if character_age is not None and character_age >= 60 else 180.0
        return median_pitch >= max(floor, target_pitch - 25 if target_pitch is not None else floor)
    if expected_gender == "male":
        return median_pitch <= 210
    return True


def gender_pitch_score(
    expected_gender: str,
    median_pitch: float | None,
    target_pitch: float | None = None,
    character_age: int | None = None,
    pitch_min_hz: float | None = None,
    pitch_max_hz: float | None = None,
) -> float:
    if median_pitch is None:
        return float("-inf")
    if expected_gender in {"female", "male"} and not gender_pitch_matches(
        expected_gender, median_pitch, character_age, target_pitch, pitch_min_hz, pitch_max_hz
    ):
        return -1_000_000.0 - abs(median_pitch - target_pitch) if target_pitch is not None else -1_000_000.0
    if target_pitch is not None:
        return -abs(median_pitch - target_pitch)
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


class VoiceDesignRuntime:
    def __init__(self) -> None:
        self.model: Any | None = None
        self.model_dir: Path | None = None
        self.torch: Any | None = None

    def release(self) -> bool:
        had_model = self.model is not None
        torch = self.torch
        self.model = None
        self.model_dir = None
        self.torch = None
        gc.collect()
        if torch is not None:
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
            except Exception:
                pass
        return had_model

    def get_model(self, payload: dict[str, Any], status_path: Path) -> tuple[Any, Any, bool]:
        requested_model_dir = Path(payload["model_dir"]).resolve()
        required_paths = [requested_model_dir / "config.json", requested_model_dir / "model.safetensors", requested_model_dir / "speech_tokenizer"]
        missing = [str(path) for path in required_paths if not path.exists()]
        if missing:
            raise FileNotFoundError("VoiceDesign 模型文件不完整：" + "，".join(missing))
        if self.model is not None:
            if requested_model_dir != self.model_dir:
                raise ValueError(f"驻留 VoiceDesign 已加载 {self.model_dir}，不能切换到 {requested_model_dir}")
            _write_json(status_path, {"phase": "model_ready", "fraction": 0.04, "message": "正在复用已驻留的 Qwen3-TTS VoiceDesign"})
            return self.model, self.torch, True

        _write_json(status_path, {"phase": "loading", "fraction": 0.02, "message": "正在加载 Qwen3-TTS VoiceDesign"})
        import torch
        from qwen_tts import Qwen3TTSModel

        torch.set_float32_matmul_precision("high")
        self.model = Qwen3TTSModel.from_pretrained(
            str(requested_model_dir),
            device_map="cuda:0",
            dtype=torch.bfloat16,
            attn_implementation="sdpa",
        )
        self.model_dir = requested_model_dir
        self.torch = torch
        return self.model, self.torch, False


def generate_voice_design(
    payload: dict[str, Any],
    result_path: Path,
    status_path: Path,
    runtime: VoiceDesignRuntime | None = None,
) -> dict[str, Any]:
    jobs = payload.get("jobs") or []
    if not jobs:
        raise ValueError("没有需要生成的角色音色。")

    output_dir = Path(payload["output_dir"]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    import soundfile as sf
    runtime = runtime or VoiceDesignRuntime()
    model, torch, model_reused = runtime.get_model(payload, status_path)
    torch.manual_seed(int(payload.get("seed", 42)))

    generated: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
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
        target_pitch = float(job["pitch_target_hz"]) if job.get("pitch_target_hz") is not None else None
        pitch_min_hz = float(job["pitch_min_hz"]) if job.get("pitch_min_hz") is not None else None
        pitch_max_hz = float(job["pitch_max_hz"]) if job.get("pitch_max_hz") is not None else None
        character_age = int(job["character_age"]) if job.get("character_age") is not None else None
        generation = job.get("voice_generation") if isinstance(job.get("voice_generation"), dict) else {}
        requested_candidates = max(1, min(6, int(generation.get("candidate_count", 1))))
        if expected_gender in {"female", "male"} or target_pitch is not None:
            configured_budget = int(payload.get("gender_max_attempts", requested_candidates * 3))
            max_attempts = max(requested_candidates, min(18, configured_budget))
        else:
            max_attempts = requested_candidates
        best_wav, best_sample_rate, best_pitch, best_score, attempts_used = None, None, None, float("-inf"), 0
        best_attempt_pitch, best_attempt_score = None, float("-inf")
        candidate_metrics: list[dict[str, Any]] = []
        valid_candidate_count = 0
        evaluate_all_candidates = max_attempts > 1
        for attempt in range(max_attempts):
            candidate_seed = job_seed + attempt
            torch.manual_seed(candidate_seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(candidate_seed)
            if attempt:
                retry_message = (
                    f"{job['name']} 正在评估并校准频率候选 {attempt + 1}/{max_attempts}"
                    if evaluate_all_candidates
                    else f"{job['name']} 音色性别校验未通过，正在重试 {attempt + 1}/{max_attempts}"
                )
                _write_json(
                    status_path,
                    {
                        "phase": "gender_retry",
                        "fraction": 0.08 + 0.86 * (index - 0.5) / len(jobs),
                        "message": retry_message,
                    },
                )
            wavs, sample_rate = model.generate_voice_design(
                text=str(job["text"]),
                language=str(job.get("language") or "Auto"),
                instruct=str(job["instruct"]),
                do_sample=bool(generation.get("do_sample", True)),
                top_k=int(generation.get("top_k", 50)),
                top_p=float(generation.get("top_p", 0.95)),
                temperature=float(generation.get("temperature", 0.85)),
                repetition_penalty=float(generation.get("repetition_penalty", 1.05)),
                subtalker_dosample=bool(generation.get("subtalker_dosample", True)),
                subtalker_top_k=int(generation.get("subtalker_top_k", 50)),
                subtalker_top_p=float(generation.get("subtalker_top_p", 0.95)),
                subtalker_temperature=float(generation.get("subtalker_temperature", 0.85)),
                max_new_tokens=int(generation.get("max_new_tokens", 2048)),
            )
            candidate_wav = wavs[0]
            raw_pitch = estimate_median_pitch(candidate_wav, sample_rate) if expected_gender in {"female", "male"} or target_pitch is not None else None
            raw_gender_matched = expected_gender not in {"female", "male"} or gender_pitch_matches(
                expected_gender, raw_pitch, character_age, target_pitch, pitch_min_hz, pitch_max_hz
            )
            if raw_gender_matched:
                candidate_wav, median_pitch, correction_semitones, target_matched = calibrate_pitch_to_target(
                    candidate_wav, sample_rate, raw_pitch, target_pitch
                )
            else:
                median_pitch, correction_semitones, target_matched = raw_pitch, 0.0, target_pitch is None
            candidate_path = output_dir / f"{Path(str(job['filename'])).stem}-candidate-{attempt + 1}.wav"
            candidate_wav, median_pitch, correction_semitones, target_matched = persist_calibrated_candidate(
                candidate_path, candidate_wav, sample_rate, target_pitch, correction_semitones
            )
            gender_matched = raw_gender_matched and (
                expected_gender not in {"female", "male"}
                or gender_pitch_matches(expected_gender, median_pitch, character_age, target_pitch, pitch_min_hz, pitch_max_hz)
            )
            score = gender_pitch_score(expected_gender, median_pitch, target_pitch, character_age, pitch_min_hz, pitch_max_hz)
            diagnostic_score = -abs(median_pitch - target_pitch) if median_pitch is not None and target_pitch is not None else float(median_pitch or float("-inf"))
            if diagnostic_score > best_attempt_score:
                best_attempt_pitch, best_attempt_score = median_pitch, diagnostic_score
            accepted = gender_matched and target_matched
            candidate_metrics.append(
                {
                    "seed": candidate_seed,
                    "raw_median_pitch_hz": raw_pitch,
                    "median_pitch_hz": median_pitch,
                    "pitch_delta_hz": round(abs(float(median_pitch) - target_pitch), 2) if median_pitch is not None and target_pitch is not None else None,
                    "pitch_target_tolerance_hz": pitch_target_tolerance_hz(target_pitch) if target_pitch is not None else None,
                    "pitch_target_matched": target_matched,
                    "pitch_correction_semitones": correction_semitones,
                    "pitch_correction_method": "librosa_phase_vocoder" if correction_semitones else "none",
                    "gender_matched": gender_matched,
                    "age_band_verified": gender_matched,
                    "gender_identity_verified": False if character_age is not None and character_age < 13 and expected_gender in {"female", "male"} else gender_matched,
                    "gender_identity_method": "pending_human" if character_age is not None and character_age < 13 and expected_gender in {"female", "male"} else "acoustic_pitch",
                    "selected": False,
                    "recommended": False,
                    "path": str(candidate_path),
                }
            )
            if accepted:
                valid_candidate_count += 1
            if accepted and (best_wav is None or score > best_score):
                best_wav, best_sample_rate, best_pitch, best_score = candidate_wav, sample_rate, median_pitch, score
                for metric in candidate_metrics:
                    metric["recommended"] = False
                candidate_metrics[-1]["recommended"] = True
            attempts_used = attempt + 1
            if valid_candidate_count >= requested_candidates:
                break
        if valid_candidate_count < requested_candidates:
            label = "女性" if expected_gender == "female" else "男性" if expected_gender == "male" else ""
            measured = "无法测量" if best_attempt_pitch is None else f"{best_attempt_pitch:.1f} Hz"
            target_requirement = (
                f"且进入目标 {target_pitch:.1f} Hz ± {pitch_target_tolerance_hz(target_pitch):.1f} Hz"
                if target_pitch is not None else ""
            )
            failures.append(
                {
                    "role_id": str(job["role_id"]),
                    "name": str(job["name"]),
                    "error": (
                        f"{job['name']} 要求 {requested_candidates} 个{label}候选，连续 {attempts_used} 次生成后只有 "
                        f"{valid_candidate_count} 个通过声学年龄与性别校验{target_requirement}，最接近目标的尝试为 {measured}。"
                    ),
                    "generation_attempts": attempts_used,
                    "requested_candidate_count": requested_candidates,
                    "valid_candidate_count": valid_candidate_count,
                    "candidate_metrics": candidate_metrics,
                }
            )
            continue
        output_path = output_dir / str(job["filename"])
        sf.write(output_path, best_wav, best_sample_rate)
        generated.append(
            {
                "role_id": str(job["role_id"]),
                "name": str(job["name"]),
                "path": str(output_path),
                "expected_gender": expected_gender,
                "median_pitch_hz": best_pitch,
                "pitch_target_hz": target_pitch,
                "pitch_target_tolerance_hz": pitch_target_tolerance_hz(target_pitch) if target_pitch is not None else None,
                "pitch_calibration_version": PITCH_CALIBRATION_VERSION,
                "pitch_verified": target_pitch is None or valid_candidate_count > 0,
                "generation_attempts": attempts_used,
                "requested_candidate_count": requested_candidates,
                "valid_candidate_count": valid_candidate_count,
                "gender_verified": expected_gender not in {"female", "male"} or valid_candidate_count > 0,
                "age_band_verified": expected_gender not in {"female", "male"} or valid_candidate_count > 0,
                "gender_identity_verified": False if character_age is not None and character_age < 13 and expected_gender in {"female", "male"} else expected_gender not in {"female", "male"} or valid_candidate_count > 0,
                "gender_identity_method": "pending_human" if character_age is not None and character_age < 13 and expected_gender in {"female", "male"} else "acoustic_pitch",
                "candidate_metrics": candidate_metrics,
            }
        )

    result = {
        "generated": generated,
        "failures": failures,
        "model": str(payload["model_dir"]),
        "model_reused": model_reused,
        "runtime_pid": os.getpid(),
        "duration_seconds": round(time.perf_counter() - started, 3),
    }
    _write_json(result_path, result)
    completion_message = "角色音色候选生成完成"
    if failures:
        completion_message += f"，{len(failures)} 个角色未取得完整合格候选"
    _write_json(status_path, {"phase": "complete", "fraction": 1.0, "message": completion_message})
    return result


def main() -> int:
    args = _parse_args()
    input_path = Path(args.input).resolve()
    result_path = Path(args.result).resolve()
    status_path = Path(args.status).resolve()
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    generate_voice_design(payload, result_path, status_path)
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
