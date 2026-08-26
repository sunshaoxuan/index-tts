from __future__ import annotations

from copy import deepcopy
from difflib import SequenceMatcher
from typing import Any


DIRECTOR_FIELDS = (2, 3, 4, 6, 7, 8, 9, 10, 11)


def _boundary_map(old_text: str, new_text: str) -> list[int]:
    """Map every boundary in old_text to a monotonic boundary in new_text."""
    matcher = SequenceMatcher(None, old_text, new_text, autojunk=False)
    mapped: list[int | None] = [None] * (len(old_text) + 1)
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        old_width = old_end - old_start
        new_width = new_end - new_start
        if tag == "equal":
            for offset in range(old_width + 1):
                mapped[old_start + offset] = new_start + offset
            continue
        for offset in range(old_width + 1):
            ratio = offset / old_width if old_width else 0
            mapped[old_start + offset] = round(new_start + new_width * ratio)
    last = 0
    result: list[int] = []
    for value in mapped:
        current = max(last, int(value if value is not None else last))
        result.append(current)
        last = current
    result[0] = 0
    result[-1] = len(new_text)
    return result


def _role_key(row: list[Any]) -> tuple[str, str]:
    return str(row[2]), str(row[1]).strip().casefold()


def _restore_roles(previous_roles: list[list[Any]], generated_roles: list[list[Any]]) -> tuple[list[list[Any]], dict[str, str]]:
    previous_by_key = {_role_key(row): row for row in previous_roles}
    restored: list[list[Any]] = []
    generated_to_restored: dict[str, str] = {}
    used_ids: set[str] = set()
    for generated in generated_roles:
        prior = previous_by_key.get(_role_key(generated))
        selected = deepcopy(prior or generated)
        if selected[0] in used_ids:
            selected[0] = generated[0]
        used_ids.add(str(selected[0]))
        generated_to_restored[str(generated[0])] = str(selected[0])
        restored.append(selected)
    return restored, generated_to_restored


def reapply_director_memory(
    previous_source: str,
    current_source: str,
    previous_roles: list[list[Any]],
    previous_segments: list[list[Any]],
    generated_roles: list[list[Any]],
    generated_segments: list[list[Any]],
) -> tuple[list[list[Any]], list[list[Any]], dict[str, Any]]:
    """Reapply authored segment boundaries and settings after a full AI analysis."""
    if not previous_segments or not generated_segments:
        return generated_roles, generated_segments, {"applied": False, "reason": "没有可映射的历史分句"}

    old_joined = "".join(str(row[5]) for row in previous_segments)
    new_joined = "".join(str(row[5]) for row in generated_segments)
    if not old_joined or not new_joined:
        return generated_roles, generated_segments, {"applied": False, "reason": "历史分句或新分句缺少原文"}

    similarity = SequenceMatcher(None, previous_source or old_joined, current_source or new_joined, autojunk=False).ratio()
    if similarity < 0.35:
        return generated_roles, generated_segments, {
            "applied": False,
            "reason": "新旧稿件差异过大，保留本次 AI 结果供人工确认",
            "source_similarity": round(similarity, 4),
        }

    restored_roles, generated_role_map = _restore_roles(previous_roles, generated_roles)
    role_ids = {str(row[0]) for row in restored_roles}
    old_role_ids = {str(row[0]) for row in previous_roles}
    boundary_map = _boundary_map(old_joined, new_joined)
    restored_segments: list[list[Any]] = []
    old_cursor = 0
    unchanged_text_edits = 0
    for prior in previous_segments:
        old_end = old_cursor + len(str(prior[5]))
        new_start = boundary_map[min(old_cursor, len(boundary_map) - 1)]
        new_end = boundary_map[min(old_end, len(boundary_map) - 1)]
        source_slice = new_joined[new_start:new_end]
        old_cursor = old_end
        if not source_slice or not any(character.isalnum() for character in source_slice):
            continue
        row = deepcopy(prior)
        row[5] = source_slice
        if str(prior[5]) == source_slice:
            row[6] = prior[6]
            unchanged_text_edits += int(str(prior[6]) != str(prior[5]))
        else:
            row[6] = source_slice
        if str(row[2]) not in role_ids:
            matching = next((item for item in previous_roles if str(item[0]) == str(row[2])), None)
            if matching is not None and str(matching[0]) in old_role_ids:
                restored_roles.append(deepcopy(matching))
                role_ids.add(str(matching[0]))
            else:
                generated = generated_segments[min(len(restored_segments), len(generated_segments) - 1)]
                row[2] = generated_role_map.get(str(generated[2]), str(generated[2]))
                row[3] = next((item[1] for item in restored_roles if str(item[0]) == str(row[2])), generated[3])
        restored_segments.append(row)

    if not restored_segments:
        return generated_roles, generated_segments, {"applied": False, "reason": "历史边界无法映射到新稿件"}
    for order, row in enumerate(restored_segments, start=1):
        row[0] = order
    return restored_roles, restored_segments, {
        "applied": True,
        "source_similarity": round(similarity, 4),
        "restored_segments": len(restored_segments),
        "restored_roles": len(restored_roles),
        "preserved_text_edits": unchanged_text_edits,
        "strategy": "sequence-boundary-alignment",
    }
