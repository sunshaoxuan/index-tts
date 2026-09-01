from __future__ import annotations

from copy import deepcopy
import re
from typing import Any


KEYFRAME_FIELDS = {
    "keyframe_url",
    "keyframe_prompt",
    "keyframe_style",
    "keyframe_generated_at",
    "keyframe_model",
}


def _coverage_length(value: Any) -> int:
    return len(re.sub(r"\s+", "", str(value or "")))


def _segment_spans(segments: list[dict[str, Any]]) -> tuple[list[tuple[int, int, dict[str, Any]]], int]:
    spans: list[tuple[int, int, dict[str, Any]]] = []
    cursor = 0
    for segment in segments:
        length = _coverage_length(segment.get("source_text"))
        if length <= 0:
            continue
        spans.append((cursor, cursor + length, segment))
        cursor += length
    return spans, cursor


def _best_scene_id(
    start: int,
    end: int,
    analyzed_spans: list[tuple[int, int, dict[str, Any]]],
) -> str:
    best_id = ""
    best_overlap = -1
    midpoint = (start + end) / 2
    best_distance = float("inf")
    for analyzed_start, analyzed_end, segment in analyzed_spans:
        scene_id = str(segment.get("scene_id") or "").strip()
        if not scene_id:
            continue
        overlap = max(0, min(end, analyzed_end) - max(start, analyzed_start))
        distance = abs(midpoint - ((analyzed_start + analyzed_end) / 2))
        if overlap > best_overlap or (overlap == best_overlap and distance < best_distance):
            best_id = scene_id
            best_overlap = overlap
            best_distance = distance
    return best_id


def _caption_timeline(captions: list[dict[str, Any]] | None) -> dict[int, tuple[float, float]]:
    timeline: dict[int, tuple[float, float]] = {}
    cursor = 0.0
    for caption in captions or []:
        order = int(caption.get("order") or 0)
        duration = max(0.0, float(caption.get("durationSeconds") or 0.0))
        pause = max(0.0, float(caption.get("pauseAfterMs") or 0.0)) / 1000.0
        if order > 0:
            timeline[order] = (cursor, cursor + duration + pause)
        cursor += duration + pause
    return timeline


def _shot_groups(
    segments: list[dict[str, Any]],
    timeline: dict[int, tuple[float, float]],
    target_seconds: float,
) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_duration = 0.0
    for segment in segments:
        order = int(segment.get("order") or 0)
        if order in timeline:
            start, end = timeline[order]
            duration = max(0.1, end - start)
        else:
            duration = max(1.0, _coverage_length(segment.get("source_text")) / 4.2)
        if current and current_duration >= target_seconds * 0.6 and current_duration + duration > target_seconds * 1.45:
            groups.append(current)
            current = []
            current_duration = 0.0
        current.append(segment)
        current_duration += duration
        if current_duration >= target_seconds:
            groups.append(current)
            current = []
            current_duration = 0.0
    if current:
        if groups and current_duration < target_seconds * 0.35:
            groups[-1].extend(current)
        else:
            groups.append(current)
    return groups


def _scene_shots(
    scene: dict[str, Any],
    segments: list[dict[str, Any]],
    timeline: dict[int, tuple[float, float]],
    target_seconds: float,
) -> list[dict[str, Any]]:
    shots: list[dict[str, Any]] = []
    scene_id = str(scene.get("id") or "scene")
    for index, group in enumerate(_shot_groups(segments, timeline, target_seconds), start=1):
        orders = [int(item.get("order") or 0) for item in group]
        participants: list[str] = []
        for item in group:
            speaker_id = str(item.get("speaker_id") or "").strip()
            if speaker_id and speaker_id not in participants:
                participants.append(speaker_id)
        excerpt = "".join(str(item.get("source_text") or "") for item in group).strip()
        base_note = str(scene.get("storyboard_note") or "").strip()
        shot = {
            "id": f"{scene_id}_shot_{index:03d}",
            "title": f"{str(scene.get('title') or scene_id)} · 镜头 {index:03d}",
            "storyboard_note": f"{base_note} 本镜头聚焦原文片段：{excerpt[:220]}",
            "source_excerpt": excerpt[:500],
            "participants": participants,
            "start_segment_order": min(orders),
            "end_segment_order": max(orders),
            "authoring": "ai",
        }
        timed_orders = [order for order in orders if order in timeline]
        if len(timed_orders) == len(orders):
            shot["start_seconds"] = timeline[timed_orders[0]][0]
            shot["end_seconds"] = timeline[timed_orders[-1]][1]
        shots.append(shot)
    return shots


def regenerate_storyboard_document(
    existing_document: dict[str, Any] | None,
    analyzed_document: dict[str, Any],
    captions: list[dict[str, Any]] | None = None,
    target_shot_seconds: float = 10.0,
) -> dict[str, Any]:
    current = deepcopy(existing_document) if isinstance(existing_document, dict) else {}
    existing_segments = [
        deepcopy(item)
        for item in current.get("segments") or []
        if isinstance(item, dict)
    ]
    analyzed_segments = [
        item
        for item in analyzed_document.get("segments") or []
        if isinstance(item, dict)
    ]
    analyzed_scenes = [
        item
        for item in analyzed_document.get("scenes") or []
        if isinstance(item, dict)
    ]
    if not existing_segments:
        raise ValueError("当前工程没有可用于重新划分分镜的分句，请先执行 AI 全文分析")
    if not analyzed_segments or not analyzed_scenes:
        raise ValueError("AI 没有返回可用的分镜与分句")

    existing_spans, existing_total = _segment_spans(existing_segments)
    analyzed_spans, analyzed_total = _segment_spans(analyzed_segments)
    if existing_total <= 0 or analyzed_total <= 0:
        raise ValueError("分镜重新生成缺少可对齐的原文覆盖")
    if existing_total != analyzed_total:
        raise ValueError(
            f"当前分句与 AI 分析原文覆盖不一致，当前为 {existing_total} 字符，AI 为 {analyzed_total} 字符"
        )

    assigned_segments: list[dict[str, Any]] = []
    for start, end, segment in existing_spans:
        scene_id = _best_scene_id(start, end, analyzed_spans)
        if not scene_id:
            raise ValueError(f"第 {segment.get('order', '?')} 条分句无法匹配到 AI 分镜")
        segment["scene_id"] = scene_id
        assigned_segments.append(segment)

    assigned_by_scene: dict[str, list[dict[str, Any]]] = {}
    for segment in assigned_segments:
        assigned_by_scene.setdefault(str(segment["scene_id"]), []).append(segment)

    target_shot_seconds = max(3.0, min(60.0, float(target_shot_seconds or 10.0)))
    timeline = _caption_timeline(captions)
    scenes: list[dict[str, Any]] = []
    for raw_scene in analyzed_scenes:
        scene_id = str(raw_scene.get("id") or "").strip()
        assigned = assigned_by_scene.get(scene_id, [])
        if not assigned:
            continue
        scene = {key: deepcopy(value) for key, value in raw_scene.items() if key not in KEYFRAME_FIELDS}
        orders = [int(item.get("order") or 0) for item in assigned if int(item.get("order") or 0) > 0]
        participants: list[str] = []
        for item in assigned:
            speaker_id = str(item.get("speaker_id") or "").strip()
            if speaker_id and speaker_id not in participants:
                participants.append(speaker_id)
        scene["participants"] = participants
        scene["start_segment_order"] = min(orders)
        scene["end_segment_order"] = max(orders)
        scene["shots"] = _scene_shots(scene, assigned, timeline, target_shot_seconds)
        scenes.append(scene)

    if not scenes:
        raise ValueError("AI 分镜无法映射到当前工程分句")
    scenes.sort(key=lambda item: int(item.get("start_segment_order") or 0))
    current["scenes"] = scenes
    current["segments"] = assigned_segments
    current["storyboard_regeneration"] = {
        "mode": "ai_storyboard_only",
        "scene_count": len(scenes),
        "shot_count": sum(len(scene.get("shots") or []) for scene in scenes),
        "target_shot_seconds": target_shot_seconds,
        "audio_timeline_used": bool(timeline),
        "preserved_roles": True,
        "preserved_audio_segments": True,
    }
    return current
