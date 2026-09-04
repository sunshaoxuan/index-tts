from __future__ import annotations

import argparse
from copy import deepcopy
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

from character_assets import normalize_character_assets, recommend_pitch_range
from voice_controls import recommended_voice_traits
from novel_project import NovelProjectStore, pronunciation_rows
from director_memory import reapply_director_memory
from storyboard_regeneration import regenerate_storyboard_document
from text_director import DirectorConfig, OllamaTextDirector, document_to_tables


def write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def attach_analysis_total_metrics(document: dict[str, Any]) -> dict[str, Any]:
    validation_rounds = (document.get("character_validation") or {}).get("rounds") or []
    validation_metrics = {
        "requests": sum(
            int(item.get("requests") or (1 + int(item.get("repair_attempts") or 0)))
            for item in validation_rounds
        ),
        "prompt_tokens": sum(int(item.get("prompt_tokens") or 0) for item in validation_rounds),
        "output_tokens": sum(int(item.get("output_tokens") or 0) for item in validation_rounds),
        "duration_seconds": round(sum(float(item.get("duration_seconds") or 0) for item in validation_rounds), 3),
    }
    analysis_metrics = document.setdefault("metrics", {})
    analysis_metrics.setdefault("stage_metrics", {})["character_validation"] = validation_metrics
    analysis_metrics["total_requests"] = (
        int(analysis_metrics.get("classification_requests") or 0)
        + int(analysis_metrics.get("context_requests") or 0)
        + int(analysis_metrics.get("chunks") or 0)
        + int((analysis_metrics.get("stage_metrics") or {}).get("gender_suggestion", {}).get("requests") or 0)
        + validation_metrics["requests"]
    )
    analysis_metrics["total_prompt_tokens"] = int(analysis_metrics.get("prompt_tokens") or 0) + validation_metrics["prompt_tokens"]
    analysis_metrics["total_output_tokens"] = int(analysis_metrics.get("output_tokens") or 0) + validation_metrics["output_tokens"]
    analysis_metrics["total_model_duration_seconds"] = round(
        float(analysis_metrics.get("duration_seconds") or 0) + validation_metrics["duration_seconds"],
        3,
    )
    return analysis_metrics


def analysis_voice_ids(root: Path, project: dict[str, Any]) -> list[str]:
    available_by_stem: dict[str, str] = {}
    for raw_path in project.get("voice_files") or []:
        path = Path(str(raw_path))
        if path.is_file():
            available_by_stem.setdefault(path.stem, path.stem)
    for path in (root / "outputs" / "voice-library").glob("*.wav"):
        available_by_stem.setdefault(path.stem, path.stem)
    for path in (root / "examples").glob("voice_*.wav"):
        available_by_stem.setdefault(path.stem, path.name)

    ordered: list[str] = []
    seen: set[str] = set()

    def append(raw_voice_id: Any) -> None:
        voice_id = str(raw_voice_id or "").strip()
        resolved = available_by_stem.get(Path(voice_id).stem)
        if resolved and resolved not in seen:
            seen.add(resolved)
            ordered.append(resolved)

    for row in project.get("roles") or []:
        if isinstance(row, list) and len(row) > 5:
            append(row[5])
    for asset in (project.get("character_assets") or {}).values():
        if not isinstance(asset, dict):
            continue
        for candidate in asset.get("voice_candidates") or []:
            if isinstance(candidate, dict):
                append(candidate.get("voice_id"))
    for voice_id in available_by_stem.values():
        append(voice_id)
    return ordered


def linked_article_demographic_reference(
    store: NovelProjectStore,
    project: dict[str, Any],
    max_chars: int = 24000,
) -> str:
    """Load linked article text for AI demographic reconciliation.

    The current article remains the primary source. Linked article text is sent
    back through the AI so explicit demographic facts can outrank weaker
    relationship based estimates without copying asset values directly.
    """
    current_id = str(project.get("project_id") or "")
    pending = [
        str(item.get("source_project_id") or "").strip()
        for item in project.get("linked_projects") or []
        if isinstance(item, dict) and str(item.get("source_project_id") or "").strip()
    ]
    seen = {current_id}
    references: list[str] = []
    remaining = max(0, int(max_chars))
    while pending and remaining > 0:
        project_id = pending.pop(0)
        if project_id in seen:
            continue
        seen.add(project_id)
        try:
            linked = store.load(project_id)
        except (FileNotFoundError, KeyError, ValueError):
            continue
        source = str(linked.get("source_text") or "").strip()
        if source:
            header = f"关联文章《{str(linked.get('title') or project_id).strip()}》：\n"
            entry = header + source
            references.append(entry[:remaining])
            remaining -= min(len(entry), remaining)
        pending.extend(
            str(item.get("source_project_id") or "").strip()
            for item in linked.get("linked_projects") or []
            if isinstance(item, dict)
            and str(item.get("source_project_id") or "").strip()
            and str(item.get("source_project_id") or "").strip() not in seen
        )
    return "\n\n".join(references)


def merge_analysis_roles(
    document: dict[str, Any],
    existing_roles: list[list[Any]],
    generated_roles: list[list[Any]],
    generated_segments: list[list[Any]],
    existing_characters: list[dict[str, Any]] | None = None,
) -> tuple[list[list[Any]], list[list[Any]], dict[str, Any]]:
    def name_key(kind: Any, name: Any) -> tuple[str, str]:
        return str(kind).strip(), "".join(str(name).split()).casefold()

    existing = [deepcopy(row) for row in existing_roles if isinstance(row, list) and len(row) >= 8]
    existing_by_id = {str(row[0]): row for row in existing}
    existing_by_key = {name_key(row[2], row[1]): row for row in existing}
    for character in existing_characters or []:
        if not isinstance(character, dict):
            continue
        prior = existing_by_id.get(str(character.get("id") or ""))
        if prior is None:
            continue
        for value in [character.get("name"), *(character.get("aliases") or [])]:
            if str(value or "").strip():
                existing_by_key.setdefault(name_key(prior[2], value), prior)
    generated_characters = {
        str(character.get("id") or ""): character
        for character in document.get("characters") or []
        if isinstance(character, dict)
    }
    used_ids = {str(row[0]) for row in existing}
    generated_to_final: dict[str, str] = {}
    final_by_id = {str(row[0]): row for row in existing}
    new_roles: list[list[Any]] = []
    reused_roles = 0
    merged_duplicate_existing_roles: dict[str, str] = {}

    def relationship_prefix_match(
        generated: list[Any],
        character: dict[str, Any],
        exclude_ids: set[str] | None = None,
    ) -> list[Any] | None:
        generated_name = "".join(str(character.get("name") or generated[1]).split()).casefold()
        generated_profile = str(character.get("profile") or generated[3])
        relationships = re.findall(
            r"([\u4e00-\u9fff]{2,8})的(儿子|女儿|妻子|丈夫|父亲|母亲)",
            generated_profile,
        )
        if not relationships:
            return None
        matches: list[list[Any]] = []
        for candidate in existing:
            if str(candidate[0]) in (exclude_ids or set()):
                continue
            if str(candidate[2]).strip() != str(generated[2]).strip():
                continue
            candidate_name = "".join(str(candidate[1]).split()).casefold()
            shorter = min(len(generated_name), len(candidate_name))
            if shorter < 3 or not (generated_name.startswith(candidate_name) or candidate_name.startswith(generated_name)):
                continue
            candidate_profile = str(candidate[3])
            if any(
                subject not in {generated_name, candidate_name}
                and subject in candidate_profile
                and relation in candidate_profile[candidate_profile.find(subject):candidate_profile.find(subject) + 32]
                for subject, relation in relationships
            ):
                matches.append(candidate)
        return matches[0] if len(matches) == 1 else None

    def allocate_role_id(preferred: str) -> str:
        if preferred and preferred not in used_ids:
            used_ids.add(preferred)
            return preferred
        index = 1
        while f"role_{index:03d}" in used_ids:
            index += 1
        allocated = f"role_{index:03d}"
        used_ids.add(allocated)
        return allocated

    for generated in generated_roles:
        if not isinstance(generated, list) or len(generated) < 8:
            continue
        generated_id = str(generated[0])
        character = generated_characters.get(generated_id) or {}
        candidate_names = [generated[1], character.get("name"), *(character.get("aliases") or [])]
        prior = None
        for value in candidate_names:
            if not str(value or "").strip():
                continue
            prior = existing_by_key.get(name_key(generated[2], value))
            if prior is not None:
                break
        relationship_prior = relationship_prefix_match(
            generated,
            character,
            {str(prior[0])} if prior is not None else set(),
        )
        if (
            prior is not None
            and relationship_prior is not None
            and not str(prior[5] or "").strip()
            and str(relationship_prior[5] or "").strip()
        ):
            merged_duplicate_existing_roles[str(prior[0])] = str(relationship_prior[0])
            prior = relationship_prior
        elif prior is None:
            prior = relationship_prior
        if prior is not None:
            final_id = str(prior[0])
            final_row = final_by_id[final_id]
            reused_roles += 1
        else:
            final_row = deepcopy(generated)
            final_id = allocate_role_id(generated_id)
            final_row[0] = final_id
            final_row[5] = ""
            final_row[7] = "是"
            final_by_id[final_id] = final_row
            new_roles.append(final_row)
        generated_to_final[generated_id] = final_id

    final_roles = [row for row in existing if str(row[0]) not in merged_duplicate_existing_roles] + new_roles
    role_name_by_id = {str(row[0]): str(row[1]) for row in final_roles}
    final_segments: list[list[Any]] = []
    for segment in generated_segments:
        copied = deepcopy(segment)
        source_id = str(copied[2])
        final_id = generated_to_final.get(source_id, source_id)
        copied[2] = final_id
        copied[3] = role_name_by_id.get(final_id, copied[3])
        final_segments.append(copied)

    for character in document.get("characters") or []:
        source_id = str(character.get("id") or "")
        final_id = generated_to_final.get(source_id, source_id)
        original_name = str(character.get("name") or "").strip()
        character["id"] = final_id
        character["name"] = role_name_by_id.get(final_id, character.get("name"))
        if original_name and original_name != character["name"]:
            aliases = {str(item).strip() for item in character.get("aliases") or [] if str(item).strip()}
            aliases.add(original_name)
            character["aliases"] = sorted(aliases)
    for segment in document.get("segments") or []:
        source_id = str(segment.get("speaker_id") or "")
        final_id = generated_to_final.get(source_id, source_id)
        segment["speaker_id"] = final_id
        segment["speaker_name"] = role_name_by_id.get(final_id, segment.get("speaker_name"))

    return final_roles, final_segments, {
        "existing_roles": len(existing),
        "reused_roles": reused_roles,
        "new_roles": len(new_roles),
        "new_roles_pending_voice_selection": len(new_roles),
        "retained_unmentioned_roles": max(0, len(final_roles) - len(new_roles) - reused_roles),
        "merged_duplicate_existing_roles": merged_duplicate_existing_roles,
        "generated_to_final": generated_to_final,
    }


def apply_analysis_demographics(
    document: dict[str, Any],
    roles: list[list[Any]],
    existing_assets: dict[str, Any] | None,
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    current = existing_assets if isinstance(existing_assets, dict) else {}
    characters = {
        str(item.get("id") or ""): item
        for item in document.get("characters", [])
        if isinstance(item, dict)
    }
    prepared = deepcopy(current)
    analyzed = 0
    changed = 0
    for row in roles:
        role_id = str(row[0])
        role_kind = str(row[2])
        if role_kind not in {"character", "narrator"}:
            if isinstance(prepared.get(role_id), dict):
                prepared[role_id] = deepcopy(prepared[role_id])
            continue
        character = characters.get(role_id)
        source = deepcopy(prepared.get(role_id)) if isinstance(prepared.get(role_id), dict) else {}
        if character is None:
            existing_age = source.get("age")
            if not isinstance(existing_age, int) or isinstance(existing_age, bool):
                raise ValueError(f"保留角色 {row[1]} 不在本次 AI 人物表且缺少既有年龄")
            prepared[role_id] = source
            continue
        character = character or {}
        prior_age = source.get("age")
        prior_gender = source.get("gender")
        inferred_age = character.get("age") if isinstance(character.get("age"), int) and not isinstance(character.get("age"), bool) else None
        if role_kind == "character" and inferred_age is None:
            raise ValueError(f"本次 AI 人物 {row[1]} 缺少文章证据支持的年龄推断")
        preserve_manual_narrator_gender = (
            role_kind == "narrator"
            and prior_gender in {"female", "male"}
            and source.get("gender_source") in {"manual", "user"}
        )
        inferred_gender = character.get("gender") if character.get("gender") in {"female", "male", "unspecified"} else "unspecified"
        if preserve_manual_narrator_gender:
            inferred_gender = prior_gender
        demographic_changed = False
        if inferred_age is not None:
            inferred_age = max(5, min(100, inferred_age))
            demographic_changed = prior_age is not None and int(prior_age) != inferred_age
            source["age"] = inferred_age
            source["age_source"] = "ai_article_inference"
            source["age_evidence"] = str(character.get("age_evidence") or "").strip()
            source["age_basis"] = str(character.get("age_basis") or "unknown")
        demographic_changed = demographic_changed or (prior_gender is not None and prior_gender != inferred_gender)
        source["gender"] = inferred_gender
        if not preserve_manual_narrator_gender:
            source["gender_source"] = "ai_recommended_default" if character.get("gender_recommendation_only") else "ai_article_inference"
            source["gender_evidence"] = str(character.get("gender_evidence") or "").strip()
            source["gender_basis"] = str(character.get("gender_basis") or "unknown")
            source["gender_recommendation_only"] = bool(character.get("gender_recommendation_only"))
        analyzed += 1
        if demographic_changed:
            age = int(source.get("age") or 35)
            gender = str(source.get("gender") or "unspecified")
            minimum, maximum, target = recommend_pitch_range(gender, age)
            source.update({
                "pitch_min_hz": minimum,
                "pitch_max_hz": maximum,
                "pitch_target_hz": target,
                "voice_traits": recommended_voice_traits(age),
            })
            source.pop("voice_candidates", None)
            row[7] = "是"
            changed += 1
        prepared[role_id] = source
    return normalize_character_assets(roles, prepared), {"analyzed": analyzed, "changed": changed}


def prepare_single_anchor_analysis(
    document: dict[str, Any],
    existing_roles: list[list[Any]],
    existing_document: dict[str, Any] | None,
) -> tuple[list[list[Any]], list[dict[str, Any]]]:
    retained = next((deepcopy(row) for row in existing_roles if isinstance(row, list) and len(row) >= 8 and str(row[2]) == "anchor"), None)
    anchor = next((item for item in document.get("characters") or [] if isinstance(item, dict) and item.get("kind") == "anchor"), None)
    if anchor is None:
        raise ValueError("新闻或评论分析缺少唯一主播")
    document["characters"] = [anchor]
    if retained is not None:
        previous_id = str(anchor.get("id") or "anchor")
        anchor["id"] = str(retained[0])
        anchor["name"] = str(retained[1])
        anchor["profile"] = str(retained[3]) or str(anchor.get("profile") or "")
        anchor["voice_hint"] = str(retained[4]) or str(anchor.get("voice_hint") or "")
        for segment in document.get("segments") or []:
            segment["speaker_id"] = anchor["id"]
            segment["speaker_name"] = anchor["name"]
            segment["speaker_kind"] = "anchor"
            segment["speaker_candidates"] = [anchor["id"]]
        for scene in document.get("scenes") or []:
            scene["participants"] = [anchor["id"]]
    previous_characters = [
        deepcopy(item)
        for item in (existing_document or {}).get("characters", [])
        if isinstance(item, dict) and str(item.get("id") or "") == str(anchor.get("id") or "")
    ]
    return ([retained] if retained is not None else []), previous_characters


def enforce_single_anchor_tables(
    document: dict[str, Any],
    roles: list[list[Any]],
    segments: list[list[Any]],
) -> None:
    anchors = [row for row in roles if isinstance(row, list) and len(row) >= 8 and str(row[2]) == "anchor"]
    if len(anchors) != 1:
        raise ValueError(f"新闻或评论必须只有一个主播，当前为 {len(anchors)} 个")
    anchor_id, anchor_name = str(anchors[0][0]), str(anchors[0][1])
    for row in segments:
        row[2] = anchor_id
        row[3] = anchor_name
    document["characters"] = [item for item in document.get("characters") or [] if str(item.get("id") or "") == anchor_id]
    for item in document["characters"]:
        item["name"] = anchor_name
        item["kind"] = "anchor"
    for item in document.get("segments") or []:
        item["speaker_id"] = anchor_id
        item["speaker_name"] = anchor_name
        item["speaker_kind"] = "anchor"
        item["speaker_candidates"] = [anchor_id]
        item["speaker_confidence"] = 1.0
    for scene in document.get("scenes") or []:
        scene["participants"] = [anchor_id]


def apply_validated_character_profiles(
    document: dict[str, Any],
    roles: list[list[Any]],
) -> dict[str, int]:
    characters = {
        str(item.get("id") or ""): item
        for item in document.get("characters", [])
        if isinstance(item, dict) and item.get("kind") != "narrator"
    }
    analyzed = 0
    changed = 0
    for row in roles:
        character = characters.get(str(row[0]))
        if character is None:
            continue
        profile = str(character.get("profile") or "").strip()
        if not profile:
            raise ValueError(f"本次 AI 人物 {row[1]} 缺少逐轮校验后的小传")
        analyzed += 1
        if str(row[3]).strip() != profile:
            row[3] = profile
            changed += 1
    return {"analyzed": analyzed, "changed": changed}


def current_document_with_project_segments(project: dict[str, Any]) -> dict[str, Any]:
    """Build the storyboard document against the user's current segment table."""
    document = deepcopy(project.get("document")) if isinstance(project.get("document"), dict) else {}
    existing_rows = [item for item in document.get("segments") or [] if isinstance(item, dict)]
    existing_by_order = {
        int(item.get("order") or 0): item
        for item in existing_rows
        if isinstance(item, dict) and int(item.get("order") or 0) > 0
    }
    role_kind_by_id = {
        str(row[0]): str(row[2])
        for row in project.get("roles") or []
        if isinstance(row, list) and len(row) >= 3
    }
    existing_spans: list[tuple[int, int, dict[str, Any]]] = []
    existing_cursor = 0
    for item in existing_rows:
        length = len(re.sub(r"\s+", "", str(item.get("source_text") or "")))
        if length > 0:
            existing_spans.append((existing_cursor, existing_cursor + length, item))
            existing_cursor += length
    segments: list[dict[str, Any]] = []
    current_cursor = 0
    for raw in project.get("segments") or []:
        if not isinstance(raw, list) or len(raw) < 12:
            continue
        order = int(raw[0])
        length = len(re.sub(r"\s+", "", str(raw[5] or "")))
        current_end = current_cursor + length
        aligned = max(
            existing_spans,
            key=lambda span: max(0, min(current_end, span[1]) - max(current_cursor, span[0])),
            default=None,
        )
        segment = deepcopy(aligned[2] if aligned and max(0, min(current_end, aligned[1]) - max(current_cursor, aligned[0])) > 0 else existing_by_order.get(order, {}))
        segment.update({
            "order": order,
            "section": str(raw[1]),
            "speaker_id": str(raw[2]),
            "speaker_name": str(raw[3]),
            "speaker_kind": role_kind_by_id.get(str(raw[2]), str(segment.get("speaker_kind") or "character")),
            "language": str(raw[4]),
            "source_text": str(raw[5]),
            "text": str(raw[6]),
            "attitude": str(raw[7]),
            "emotion": str(raw[8]),
            "intensity": float(raw[9]),
            "pace": str(raw[10]),
            "pause_after_ms": int(raw[11]),
        })
        segments.append(segment)
        current_cursor = current_end
    document["segments"] = segments
    return document


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--status", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    storyboard_only = bool(payload.get("storyboard_only"))
    root = Path(payload["root"]).resolve()
    status_path = Path(args.status).resolve()
    store = NovelProjectStore(root / "outputs" / "novel-projects", root / "outputs" / "voice-library")
    project = store.load(payload["project_id"])
    director_config = dict(payload["config"])
    settings_file = Path(director_config.pop("settings_file", root / "runtime-output" / "product-settings.json"))
    if director_config.get("provider") == "compatible":
        settings = json.loads(settings_file.read_text(encoding="utf-8"))
        director_config["api_key"] = str(settings.get("api_key") or "")
    director = OllamaTextDirector(DirectorConfig(**director_config))
    write_json(status_path, {"phase": "connecting", "fraction": 0.01, "message": "正在连接全局 AI 文本导演"})
    director.health_summary()
    warmup_metrics = {"duration_seconds": 0.0, "load_duration_seconds": 0.0}
    if director.config.provider == "ollama":
        write_json(status_path, {"phase": "loading_model", "fraction": 0.02, "message": "正在以统一上下文加载本地 AI 模型"})
        warmup_metrics = director.warm_model()
        write_json(status_path, {"phase": "planning", "fraction": 0.03, "message": "本地 AI 模型已就绪，正在拆分全文任务"})
    def progress(fraction: float, desc: str = "", description: str = "") -> None:
        write_json(status_path, {"phase": "analyzing", "fraction": fraction, "message": desc or description})
    def analysis_progress(fraction: float, desc: str = "", description: str = "") -> None:
        progress(0.03 + max(0.0, min(1.0, fraction)) * 0.69, desc or description)
    def validation_progress(fraction: float, desc: str = "", description: str = "") -> None:
        progress(0.74 + max(0.0, min(1.0, fraction)) * 0.20, desc or description)
    def storyboard_analysis_progress(fraction: float, desc: str = "", description: str = "") -> None:
        progress(0.02 + max(0.0, min(1.0, fraction)) * 0.68, desc or description)
    def storyboard_shot_progress(fraction: float, desc: str = "", description: str = "") -> None:
        progress(0.72 + max(0.0, min(1.0, fraction)) * 0.27, desc or description)
    requested_type = str(project.get("content_type") or "auto")
    demographic_reference = linked_article_demographic_reference(store, project) if requested_type in {"auto", "novel", "story"} else ""
    document = director.analyze_document(
        project["source_text"],
        content_type=project["content_type"],
        guidance=project.get("guidance", ""),
        progress=storyboard_analysis_progress if storyboard_only else analysis_progress,
        demographic_reference_text=demographic_reference,
    )
    document.setdefault("metrics", {})["warmup"] = warmup_metrics
    if storyboard_only:
        storyboard_document = regenerate_storyboard_document(
            current_document_with_project_segments(project),
            document,
            captions=payload.get("storyboard_captions") if isinstance(payload.get("storyboard_captions"), list) else None,
            target_shot_seconds=float(payload.get("target_shot_seconds") or 10.0),
        )
        storyboard_document = director.author_storyboard_shots(
            storyboard_document,
            progress=storyboard_shot_progress,
        )
        history = list(project.get("director_history") or [])
        history.append({
            "operation_id": str(uuid.uuid4()),
            "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "actor": "ai-storyboard",
            "changes": ["AI 重新生成全部分镜", "AI 根据各镜头对应原文独立撰写画面小记"],
            "memory_report": storyboard_document["storyboard_regeneration"],
        })
        store.save(
            project["project_id"],
            title=project["title"],
            content_type=project["content_type"],
            source_text=project["source_text"],
            guidance=project.get("guidance", ""),
            document=storyboard_document,
            roles=project.get("roles") or [],
            segments=project.get("segments") or [],
            pronunciations=pronunciation_rows(project.get("pronunciations")),
            voice_files=project.get("voice_files") or [],
            director_history=history,
            director_memory=project.get("director_memory") or {},
            character_assets=project.get("character_assets") or {},
        )
        scene_count = len(storyboard_document.get("scenes") or [])
        shot_count = int(storyboard_document["storyboard_regeneration"].get("shot_count") or 0)
        result = {
            "document": storyboard_document,
            "roles": project.get("roles") or [],
            "segments": project.get("segments") or [],
            "storyboard_regeneration": storyboard_document["storyboard_regeneration"],
        }
        write_json(Path(args.result).resolve(), result)
        write_json(status_path, {
            "phase": "complete",
            "fraction": 1.0,
            "message": f"AI 已重新生成全部分镜，共 {scene_count} 个场景、{shot_count} 个镜头",
        })
        return 0
    single_anchor = document.get("content_type") in {"news", "commentary"}
    if single_anchor:
        document["character_validation"] = {
            "all_valid": True,
            "round_count": 0,
            "rounds": [],
            "summary": "新闻或评论采用单主播管线，不执行稿件人物年龄、性别与小传校验",
        }
    else:
        document["character_validation"] = director.validate_character_analysis(
            document,
            project["source_text"],
            demographic_reference_text=demographic_reference,
            max_rounds=5,
            progress=validation_progress,
        )
    attach_analysis_total_metrics(document)
    existing_roles = project.get("roles") or []
    previous_characters = (project.get("document") or {}).get("characters") or []
    if single_anchor:
        existing_roles, previous_characters = prepare_single_anchor_analysis(
            document,
            existing_roles,
            project.get("document") or {},
        )
    roles, segments = document_to_tables(document, analysis_voice_ids(root, project))
    roles, segments, linked_role_report = merge_analysis_roles(
        document, existing_roles, roles, segments, previous_characters,
    )
    roles, segments, memory_report = reapply_director_memory(
        "", project["source_text"], project.get("roles") or [], project.get("segments") or [], roles, segments,
    )
    if single_anchor:
        enforce_single_anchor_tables(document, roles, segments)
        profile_report = {"analyzed": 0, "changed": 0}
    else:
        profile_report = apply_validated_character_profiles(document, roles)
    character_assets, demographic_report = apply_analysis_demographics(document, roles, project.get("character_assets"))
    document["director_memory_reapply"] = memory_report
    document["linked_role_merge"] = linked_role_report
    document["profile_merge"] = profile_report
    document["demographic_merge"] = demographic_report
    write_json(status_path, {"phase": "routing_guidance", "fraction": 0.98, "message": "正在用 AI 分配导演补充的角色影响范围"})
    document["guidance_routing"] = director.resolve_guidance(project.get("guidance", ""), roles)
    history = list(project.get("director_history") or [])
    history.append({
        "operation_id": str(uuid.uuid4()), "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "actor": "ai-analysis-memory", "changes": ["AI 全文分析", "历史导演操作重应用"],
        "memory_report": memory_report,
    })
    memory_snapshot = {
        "source_text": project["source_text"], "roles": roles, "character_assets": character_assets, "segments": segments,
        "pronunciations": project.get("pronunciations") or [],
    }
    store.save(
        project["project_id"], title=project["title"], content_type=document["content_type"],
        source_text=project["source_text"], guidance=project.get("guidance", ""), document=document,
        roles=roles, segments=segments, pronunciations=pronunciation_rows(project.get("pronunciations")),
        voice_files=project.get("voice_files") or [],
        director_history=history, director_memory=memory_snapshot,
        character_assets=character_assets,
    )
    result = {"document": document, "roles": roles, "segments": segments, "guidance_routing": document["guidance_routing"], "director_memory_reapply": memory_report, "linked_role_merge": linked_role_report, "demographic_merge": demographic_report}
    write_json(Path(args.result).resolve(), result)
    memory_message = f"，恢复历史分句 {memory_report.get('restored_segments', 0)} 条" if memory_report.get("applied") else ""
    write_json(status_path, {"phase": "complete", "fraction": 1.0, "message": f"AI 文本导演完成{memory_message}"})
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
