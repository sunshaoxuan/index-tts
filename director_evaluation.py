from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable

from text_director import coverage_key


def segment_boundaries(segments: Iterable[dict[str, Any]]) -> set[int]:
    boundaries: set[int] = set()
    offset = 0
    rows = list(segments)
    for segment in rows[:-1]:
        offset += len(str(segment.get("source_text", "")))
        boundaries.add(offset)
    return boundaries


def boundary_scores(candidate: list[dict[str, Any]], reference: list[dict[str, Any]]) -> dict[str, Any]:
    candidate_boundaries = segment_boundaries(candidate)
    reference_boundaries = segment_boundaries(reference)
    common = candidate_boundaries & reference_boundaries
    precision = len(common) / len(candidate_boundaries) if candidate_boundaries else float(not reference_boundaries)
    recall = len(common) / len(reference_boundaries) if reference_boundaries else float(not candidate_boundaries)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "candidate_boundaries": len(candidate_boundaries),
        "reference_boundaries": len(reference_boundaries),
        "common_boundaries": len(common),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def exact_interval_agreement(candidate: list[dict[str, Any]], reference: list[dict[str, Any]], fields: Iterable[str]) -> dict[str, Any]:
    def intervals(rows: list[dict[str, Any]]) -> dict[tuple[int, int], dict[str, Any]]:
        offset = 0
        result = {}
        for row in rows:
            text = str(row.get("source_text", ""))
            result[(offset, offset + len(text))] = row
            offset += len(text)
        return result

    candidate_intervals = intervals(candidate)
    reference_intervals = intervals(reference)
    common = sorted(candidate_intervals.keys() & reference_intervals.keys())
    agreements = {}
    for field in fields:
        equal = sum(candidate_intervals[key].get(field) == reference_intervals[key].get(field) for key in common)
        agreements[field] = {"equal": equal, "total": len(common), "agreement": round(equal / len(common), 4) if common else 0.0}
    return {"exact_intervals": len(common), "fields": agreements}


def evaluate(candidate: dict[str, Any], reference: dict[str, Any]) -> dict[str, Any]:
    candidate_segments = list(candidate.get("segments") or [])
    reference_segments = list(reference.get("segments") or [])
    candidate_source = "".join(str(item.get("source_text", "")) for item in candidate_segments)
    reference_source = "".join(str(item.get("source_text", "")) for item in reference_segments)
    if coverage_key(candidate_source) != coverage_key(reference_source):
        raise ValueError("候选结果与金标准没有覆盖同一原文")
    return {
        "source_characters": len(reference_source),
        "candidate_segments": len(candidate_segments),
        "reference_segments": len(reference_segments),
        "boundaries": boundary_scores(candidate_segments, reference_segments),
        "exact_intervals": exact_interval_agreement(
            candidate_segments,
            reference_segments,
            ("speaker_id", "attitude", "emotion", "intensity", "pace", "pause_after_ms", "scene_id"),
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="比较 AI 分句导演结果与人工金标准")
    parser.add_argument("candidate")
    parser.add_argument("reference")
    args = parser.parse_args()
    candidate = json.loads(Path(args.candidate).read_text(encoding="utf-8"))
    reference = json.loads(Path(args.reference).read_text(encoding="utf-8"))
    print(json.dumps(evaluate(candidate, reference), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
