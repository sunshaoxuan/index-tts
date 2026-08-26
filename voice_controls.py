from __future__ import annotations

from typing import Any


DEFAULT_AUDITION_TEXT = "这是我的声音。我会用清晰自然的方式，陪你走进这个故事。"
DEFAULT_VOICE_TRAITS = {
    "weight": 50, "brightness": 50, "resonance": 35, "tension": 50,
    "roughness": 15, "breathiness": 15, "nasality": 10, "articulation": 65,
    "pace": 50, "pause_density": 45, "pitch_variation": 45, "expressiveness": 50,
    "accent": "",
}


def recommended_voice_traits(age: int) -> dict[str, Any]:
    safe_age = max(5, min(100, int(age or 35)))
    if safe_age < 13:
        return {**DEFAULT_VOICE_TRAITS, "weight": 20, "brightness": 75, "resonance": 72, "tension": 58, "roughness": 5, "breathiness": 12, "articulation": 58, "pace": 58, "pause_density": 38, "pitch_variation": 68, "expressiveness": 62}
    if safe_age < 20:
        return {**DEFAULT_VOICE_TRAITS, "weight": 32, "brightness": 66, "resonance": 58, "tension": 58, "roughness": 8, "breathiness": 12, "pace": 56, "pitch_variation": 58, "expressiveness": 58}
    if safe_age < 50:
        return dict(DEFAULT_VOICE_TRAITS)
    if safe_age < 70:
        return {**DEFAULT_VOICE_TRAITS, "weight": 68, "brightness": 35, "resonance": 22, "tension": 40, "roughness": 38, "breathiness": 28, "articulation": 62, "pace": 38, "pause_density": 62, "pitch_variation": 36, "expressiveness": 42}
    return {**DEFAULT_VOICE_TRAITS, "weight": 75, "brightness": 25, "resonance": 16, "tension": 28, "roughness": 52, "breathiness": 42, "articulation": 55, "pace": 30, "pause_density": 72, "pitch_variation": 30, "expressiveness": 38}
VOICE_GENERATION_PRESETS = {
    "stable": {"do_sample": True, "top_k": 30, "top_p": 0.85, "temperature": 0.65, "repetition_penalty": 1.08, "subtalker_dosample": True, "subtalker_top_k": 30, "subtalker_top_p": 0.85, "subtalker_temperature": 0.65},
    "balanced": {"do_sample": True, "top_k": 50, "top_p": 0.95, "temperature": 0.85, "repetition_penalty": 1.05, "subtalker_dosample": True, "subtalker_top_k": 50, "subtalker_top_p": 0.95, "subtalker_temperature": 0.85},
    "explore": {"do_sample": True, "top_k": 100, "top_p": 1.0, "temperature": 1.1, "repetition_penalty": 1.03, "subtalker_dosample": True, "subtalker_top_k": 100, "subtalker_top_p": 1.0, "subtalker_temperature": 1.1},
}
DEFAULT_VOICE_GENERATION = {
    "preset": "balanced", **VOICE_GENERATION_PRESETS["balanced"],
    "seed": 42, "max_new_tokens": 2048, "candidate_count": 3,
}


def _clamp(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return max(minimum, min(maximum, number))


def normalize_voice_traits(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    result = {
        key: _clamp(source.get(key), 0, 100, fallback)
        for key, fallback in DEFAULT_VOICE_TRAITS.items()
        if key != "accent"
    }
    result["accent"] = str(source.get("accent") or "").strip()[:120]
    return result


def normalize_voice_generation(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    preset = str(source.get("preset") or "balanced")
    if preset not in {"stable", "balanced", "explore", "custom"}:
        preset = "balanced"
    defaults = DEFAULT_VOICE_GENERATION if preset == "custom" else {**DEFAULT_VOICE_GENERATION, **VOICE_GENERATION_PRESETS[preset]}
    return {
        "preset": preset,
        "do_sample": bool(source.get("do_sample", defaults["do_sample"])),
        "top_k": round(_clamp(source.get("top_k"), 1, 200, defaults["top_k"])),
        "top_p": _clamp(source.get("top_p"), 0.05, 1, defaults["top_p"]),
        "temperature": _clamp(source.get("temperature"), 0.1, 2, defaults["temperature"]),
        "repetition_penalty": _clamp(source.get("repetition_penalty"), 1, 2, defaults["repetition_penalty"]),
        "seed": round(_clamp(source.get("seed"), 0, 2_147_483_647, defaults["seed"])),
        "max_new_tokens": round(_clamp(source.get("max_new_tokens"), 256, 8192, defaults["max_new_tokens"])),
        "candidate_count": round(_clamp(source.get("candidate_count"), 1, 6, defaults["candidate_count"])),
        "subtalker_dosample": bool(source.get("subtalker_dosample", defaults["subtalker_dosample"])),
        "subtalker_top_k": round(_clamp(source.get("subtalker_top_k"), 1, 200, defaults["subtalker_top_k"])),
        "subtalker_top_p": _clamp(source.get("subtalker_top_p"), 0.05, 1, defaults["subtalker_top_p"]),
        "subtalker_temperature": _clamp(source.get("subtalker_temperature"), 0.1, 2, defaults["subtalker_temperature"]),
    }


def _scale(value: float, *labels: str) -> str:
    return labels[min(4, int(value // 20))]


def voice_traits_instruction(value: Any) -> str:
    traits = normalize_voice_traits(value)
    parts = [
        f"声音重量{_scale(traits['weight'], '非常轻薄', '偏轻', '适中', '偏厚', '非常厚重')}",
        f"音色亮度{_scale(traits['brightness'], '非常暗沉', '偏暗', '自然平衡', '偏明亮', '非常明亮')}",
        f"共鸣位置{_scale(traits['resonance'], '以胸腔共鸣为主', '胸腔与口腔之间', '以口腔共鸣为主', '口腔与头腔之间', '以头腔共鸣为主')}",
        f"声带状态{_scale(traits['tension'], '明显松弛', '偏松', '自然闭合', '偏紧致', '非常紧致')}",
        f"粗糙度{_scale(traits['roughness'], '纯净平滑', '轻微纹理', '自然颗粒感', '明显粗粝', '强烈粗粝沙哑')}",
        f"气息量{_scale(traits['breathiness'], '紧实少气声', '轻微气息', '自然气息', '明显气声', '大量气声')}",
        f"鼻音{_scale(traits['nasality'], '基本无鼻音', '轻微鼻音', '自然鼻腔参与', '明显鼻音', '强鼻音')}",
        f"吐字{_scale(traits['articulation'], '非常柔和含混', '偏柔和', '自然清晰', '清晰锋利', '极其锐利清楚')}",
        f"语速{_scale(traits['pace'], '非常缓慢', '偏慢', '自然', '偏快', '非常快')}",
        f"停顿{_scale(traits['pause_density'], '非常稀少', '偏少', '自然', '偏多', '非常密集')}",
        f"音高起伏{_scale(traits['pitch_variation'], '近乎平直', '偏平稳', '自然', '较丰富', '非常丰富')}",
        f"情绪外放{_scale(traits['expressiveness'], '极度克制', '偏克制', '自然', '较外放', '非常外放')}",
    ]
    if traits["accent"]:
        parts.append(f"地域或口音要求：{traits['accent']}")
    return f"结构化声音特征：{'；'.join(parts)}。"
