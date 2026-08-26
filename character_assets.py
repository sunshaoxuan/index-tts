from __future__ import annotations

from typing import Any


def infer_character_gender(*sources: Any) -> str:
    female_terms = ("女性", "女声", "女人", "妇人", "妻子", "母亲", "奶奶", "姐姐", "妹妹", "女儿", "少女", "女孩")
    male_terms = ("男性", "男声", "男人", "丈夫", "父亲", "爷爷", "哥哥", "弟弟", "儿子", "少年", "男孩")
    for raw in sources:
        source = str(raw or "")
        female = any(term in source for term in female_terms)
        male = any(term in source for term in male_terms)
        if female != male:
            return "female" if female else "male"
    return "unspecified"


def recommend_pitch_range(gender: str, age: int) -> tuple[int, int, int]:
    safe_age = max(5, min(100, int(age or 35)))
    if safe_age < 13:
        minimum, maximum = (190, 320) if gender == "male" else (210, 340) if gender == "female" else (190, 340)
    elif safe_age < 20:
        minimum, maximum = (120, 220) if gender == "male" else (175, 285) if gender == "female" else (120, 285)
    elif safe_age < 60:
        minimum, maximum = (85, 180) if gender == "male" else (165, 255) if gender == "female" else (90, 270)
    else:
        minimum, maximum = (75, 165) if gender == "male" else (135, 235) if gender == "female" else (80, 250)
    return minimum, maximum, round((minimum + maximum) / 2)


def normalize_character_assets(roles: list[list[Any]], existing: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    current = existing if isinstance(existing, dict) else {}
    result: dict[str, dict[str, Any]] = {}
    for role in roles:
        role_id = str(role[0])
        source = current.get(role_id) if isinstance(current.get(role_id), dict) else {}
        gender = str(source.get("gender") or infer_character_gender(role[4], role[3], role[1]))
        if gender not in {"female", "male", "unspecified"}:
            gender = "unspecified"
        age = max(5, min(100, int(source.get("age") or 35)))
        suggested_min, suggested_max, suggested_target = recommend_pitch_range(gender, age)
        minimum = float(source.get("pitch_min_hz") or suggested_min)
        maximum = float(source.get("pitch_max_hz") or suggested_max)
        target = max(minimum, min(maximum, float(source.get("pitch_target_hz") or suggested_target)))
        result[role_id] = {
            "gender": gender,
            "age": age,
            "pitch_min_hz": minimum,
            "pitch_max_hz": maximum,
            "pitch_target_hz": target,
            **({"portrait_url": str(source["portrait_url"])} if source.get("portrait_url") else {}),
            **({"portrait_prompt": str(source["portrait_prompt"])} if source.get("portrait_prompt") else {}),
            **({"profile_updated_by": str(source["profile_updated_by"])} if source.get("profile_updated_by") else {}),
        }
    return result
