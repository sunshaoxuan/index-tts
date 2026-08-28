from __future__ import annotations

import argparse
from copy import deepcopy
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

from character_assets import normalize_character_assets
from novel_project import NovelProjectStore, pronunciation_rows
from director_memory import reapply_director_memory
from text_director import DirectorConfig, OllamaTextDirector, document_to_tables


def write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


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


def merge_analysis_roles(
    document: dict[str, Any],
    existing_roles: list[list[Any]],
    generated_roles: list[list[Any]],
    generated_segments: list[list[Any]],
) -> tuple[list[list[Any]], list[list[Any]], dict[str, Any]]:
    def role_key(row: list[Any]) -> tuple[str, str]:
        return str(row[2]).strip(), "".join(str(row[1]).split()).casefold()

    existing = [deepcopy(row) for row in existing_roles if isinstance(row, list) and len(row) >= 8]
    existing_by_key = {role_key(row): row for row in existing}
    used_ids = {str(row[0]) for row in existing}
    generated_to_final: dict[str, str] = {}
    final_by_id = {str(row[0]): row for row in existing}
    new_roles: list[list[Any]] = []
    reused_roles = 0

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
        prior = existing_by_key.get(role_key(generated))
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

    final_roles = existing + new_roles
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
        character["id"] = final_id
        character["name"] = role_name_by_id.get(final_id, character.get("name"))
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
        "retained_unmentioned_roles": max(0, len(existing) - reused_roles),
        "generated_to_final": generated_to_final,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--status", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
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
    def progress(fraction: float, desc: str = "", description: str = "") -> None:
        write_json(status_path, {"phase": "analyzing", "fraction": fraction, "message": desc or description})
    document = director.analyze_document(project["source_text"], content_type=project["content_type"], guidance=project.get("guidance", ""), progress=progress)
    roles, segments = document_to_tables(document, analysis_voice_ids(root, project))
    roles, segments, linked_role_report = merge_analysis_roles(document, project.get("roles") or [], roles, segments)
    roles, segments, memory_report = reapply_director_memory(
        "", project["source_text"], project.get("roles") or [], project.get("segments") or [], roles, segments,
    )
    character_assets = normalize_character_assets(roles, project.get("character_assets"))
    document["director_memory_reapply"] = memory_report
    document["linked_role_merge"] = linked_role_report
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
    result = {"document": document, "roles": roles, "segments": segments, "guidance_routing": document["guidance_routing"], "director_memory_reapply": memory_report, "linked_role_merge": linked_role_report}
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
