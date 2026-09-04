from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np


SPEAKER_SIMILARITY_THRESHOLD = 0.72
ECHO_SIMILARITY_THRESHOLD = 0.72
STANDARD_REFERENCE_CANDIDATE_COUNT = 3
STANDARD_REFERENCE_MAX_ATTEMPTS = 30
STANDARD_REFERENCE_EMOTION_ALPHA = 0.25
STANDARD_REFERENCE_TEMPERATURE = 0.60
STANDARD_REFERENCE_TOP_K = 30
STANDARD_REFERENCE_TOP_P = 0.80
STANDARD_REFERENCE_PACES = {
    "自然": {
        "duration_factor": 1.05,
        "prompt": "自然平稳地朗读，吐字清晰，按语义停连，保持均匀语速。",
    },
    "舒缓": {
        "duration_factor": 1.18,
        "prompt": "沉稳舒缓地朗读，韵母自然舒展，短语间停连清晰，保持从容均匀的语速。",
    },
}


def delayed_echo_similarity(path: str | Path) -> float:
    with wave.open(str(path), "rb") as source:
        sample_rate = source.getframerate()
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        frames = source.readframes(min(source.getnframes(), sample_rate * 30))
    if sample_width != 2 or sample_rate <= 0 or not frames:
        return 1.0
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    samples -= float(samples.mean())
    energy = float(np.dot(samples, samples))
    if energy <= 1e-8:
        return 1.0
    minimum_lag = max(1, int(sample_rate * 0.08))
    maximum_lag = min(len(samples) // 2, int(sample_rate * 0.60))
    step = max(1, int(sample_rate * 0.02))
    similarities: list[float] = []
    for lag in range(minimum_lag, maximum_lag + 1, step):
        left = samples[:-lag]
        right = samples[lag:]
        denominator = math.sqrt(float(np.dot(left, left)) * float(np.dot(right, right)))
        if denominator > 1e-8:
            similarities.append(abs(float(np.dot(left, right)) / denominator))
    return round(max(similarities, default=1.0), 6)


def standard_reference_score(metrics: dict[str, Any]) -> float:
    echo_similarity = metrics.get("echo_similarity")
    return round(
        float(metrics.get("score") or 0)
        + float(metrics.get("speaker_similarity") or 0) * 100
        - float(1 if echo_similarity is None else echo_similarity) * 25,
        4,
    )


def standard_voice_id(source_voice_id: str, audio_path: str | Path) -> str:
    digest = hashlib.sha256()
    digest.update(str(source_voice_id).encode("utf-8"))
    with Path(audio_path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return f"voice-standard-{digest.hexdigest()[:16]}"


def register_standard_voice(
    voice_library: str | Path,
    candidate_path: str | Path,
    metadata: dict[str, Any],
) -> str:
    voice_library = Path(voice_library)
    candidate_path = Path(candidate_path)
    voice_library.mkdir(parents=True, exist_ok=True)
    voice_id = standard_voice_id(str(metadata["source_voice_id"]), candidate_path)
    target_audio = voice_library / f"{voice_id}.wav"
    if not target_audio.is_file():
        shutil.copy2(candidate_path, target_audio)
    record = {
        "version": 1,
        "voice_id": voice_id,
        "source": "standardized_reference_candidate",
        "audio_path": str(target_audio.resolve()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        **metadata,
    }
    temporary = voice_library / f"{voice_id}.json.tmp"
    temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, voice_library / f"{voice_id}.json")
    return voice_id


def project_voice_references(project_root: str | Path) -> set[str]:
    references: set[str] = set()
    for project_path in Path(project_root).glob("*/project.json"):
        try:
            project = json.loads(project_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            continue
        for role in project.get("roles") or []:
            if len(role) > 5 and str(role[5]).strip():
                references.add(Path(str(role[5])).stem)
        for asset in (project.get("character_assets") or {}).values():
            reference = asset.get("reference_audio") or {}
            if reference.get("voice_id"):
                references.add(Path(str(reference["voice_id"])).stem)
            for candidate in asset.get("voice_candidates") or []:
                if candidate.get("voice_id"):
                    references.add(Path(str(candidate["voice_id"])).stem)
            standardized = asset.get("standard_reference") or {}
            if standardized.get("source_voice_id"):
                references.add(Path(str(standardized["source_voice_id"])).stem)
            if standardized.get("adopted_voice_id"):
                references.add(Path(str(standardized["adopted_voice_id"])).stem)
            for candidate in standardized.get("candidates") or []:
                if candidate.get("voice_id"):
                    references.add(Path(str(candidate["voice_id"])).stem)
    return references


def cleanup_unreferenced_standard_voices(
    project_root: str | Path,
    voice_library: str | Path,
    candidate_ids: list[str],
) -> list[str]:
    references = project_voice_references(project_root)
    removed: list[str] = []
    for voice_id in candidate_ids:
        stem = Path(str(voice_id)).stem
        if not stem.startswith("voice-standard-") or stem in references:
            continue
        for suffix in (".wav", ".json"):
            try:
                (Path(voice_library) / f"{stem}{suffix}").unlink()
            except FileNotFoundError:
                pass
        removed.append(stem)
    return removed
