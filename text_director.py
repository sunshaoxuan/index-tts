from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import shutil
import time
import wave
import zipfile
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import urlparse

import requests
import numpy as np

from novel_project import assign_numbered_chapter_sections, apply_pronunciations, normalize_pronunciations
from voice_controls import DEFAULT_AUDITION_TEXT, normalize_voice_generation, normalize_voice_traits, voice_traits_instruction


CONTENT_TYPES = {
    "自动识别": "auto",
    "小说": "novel",
    "新闻": "news",
    "一般评论": "commentary",
    "故事": "story",
}
CONTENT_TYPE_LABELS = {value: key for key, value in CONTENT_TYPES.items() if value != "auto"}
ANALYZED_CONTENT_TYPES = {"novel", "news", "commentary", "story"}
SINGLE_ANCHOR_CONTENT_TYPES = {"news", "commentary"}
ROLE_KINDS = {"narrator", "character", "anchor", "reporter", "interviewee"}
EMOTIONS = {"happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm"}
EMOTION_LABELS = {
    "happy": "喜悦",
    "angry": "愤怒",
    "sad": "悲伤",
    "afraid": "恐惧",
    "disgusted": "厌恶",
    "melancholic": "低落",
    "surprised": "惊喜",
    "calm": "平静",
}
EMOTION_VALUES = {label: value for value, label in EMOTION_LABELS.items()}
VOICE_STYLE_PRESETS = {
    "中性清晰": "中性、清晰、自然，吐字准确",
    "低沉厚实": "低沉厚实，声音有支撑，气息稳定",
    "温和亲切": "温和亲切，声线柔和，交流感自然",
    "清亮年轻": "清亮年轻，声音通透，富有朝气",
    "冷静克制": "冷静克制，情绪内收，表达理性",
    "紧张警觉": "紧张警觉，声音收紧，保持清晰",
    "悲伤低落": "悲伤低落，声音低回，情绪含蓄",
    "威严有力": "威严有力，声音坚实，表达明确",
    "沙哑沧桑": "略带沙哑和沧桑感，气息自然",
    "轻快活泼": "轻快活泼，声音明亮，富有活力",
}
RHYTHM_PRESETS = {
    "自然叙述": "自然表达，按语义停连",
    "沉稳舒缓": "沉稳舒缓，重音清晰，短语间自然停连",
    "紧凑清晰": "紧凑表达，声母清晰，保持自然换气",
    "轻快活泼": "轻快灵动，声母清楚，短句间自然换气",
    "克制停连": "克制表达，短语边界清楚，停连分明",
    "低声内敛": "低声内敛，韵母轻收，短语间自然停连",
    "威严有力": "坚定有力，重音明确，停顿干脆",
}
PACE_PRESETS = {
    "自然": ("medium", "自然表达，按语义停连"),
    "舒缓": ("slow", "舒缓表达，韵母自然舒展，短语间停连清晰"),
    "紧凑": ("fast", "紧凑表达，声母清晰，保持自然换气"),
    "轻快": ("medium", "轻快表达，短句间自然换气"),
    "克制": ("medium", "克制表达，重音内收，停连清楚"),
    "低声": ("medium", "低声表达，韵母轻收，短语间自然停连"),
    "强调": ("medium", "重点词清晰强调，语义停顿明确"),
}
ATTITUDE_PRESETS = {
    "中性叙述": "中性、客观地叙述",
    "沉稳叙述": "沉稳、从容地叙述",
    "温和交流": "温和、亲切地交流",
    "紧张警觉": "紧张、警觉地表达",
    "克制低沉": "克制、低沉地表达",
    "悲伤压抑": "悲伤、压抑地表达",
    "喜悦明快": "喜悦、明快地表达",
    "愤怒强烈": "愤怒、强烈地表达",
    "恐惧迟疑": "恐惧、迟疑地表达",
    "威严命令": "威严、明确地命令",
}
EMOTION_DIRECTION_PRESETS = {
    "auto": ("跟随基础情绪", "", 0.6),
    "sly_smile": ("坏笑着说", "speaking with a sly mischievous smile, slightly teasing and amused", 0.8),
    "urgent_question": ("急切地问", "urgent and impatient, asking quickly and eagerly, fast-paced speech with strong questioning intonation", 0.85),
    "inner_thought": ("暗自思忖", "quiet internal monologue, thinking to oneself, contemplative and suspicious, subdued voice with slight hesitation", 0.7),
    "cold_statement": ("冷冷地说", "cold and restrained, emotionally distant, speaking slowly with a firm controlled tone", 0.7),
    "hushed_warning": ("压低声音警告", "lowered voice, tense and cautionary, delivering a controlled warning with deliberate emphasis", 0.8),
    "restrained_sadness": ("强忍悲伤", "holding back grief, subdued and fragile, restrained sorrow with slight breathiness", 0.75),
    "angry_interrogation": ("愤怒质问", "angry and confrontational questioning, forceful emphasis, rising intensity and sharp interrogative intonation", 0.9),
    "fearful_whisper": ("惊恐低语", "fearful whisper, tense breathing, hesitant and alarmed while keeping the voice low", 0.8),
    "gentle_comfort": ("温柔安慰", "gentle and reassuring, warm compassionate tone, calm pacing with soft supportive emphasis", 0.65),
    "excited_announcement": ("兴奋宣布", "excited and energetic announcement, bright tone, lively pacing and clear enthusiastic emphasis", 0.8),
    "custom": ("自定义描述", "", 0.7),
}
PACES = {"slow", "medium", "fast"}
PACE_FACTORS = {"slow": 1.18, "medium": 1.05, "fast": 0.92}
SPEAKER_SIMILARITY_THRESHOLD = 0.72
LANGUAGES = {"ZH", "EN", "JA", "ES", "AR"}
ATTRIBUTION_PATTERN = re.compile(
    r"(?:说|说道|问|问道|答|回答|回应|喊|叫|道|补充|解释|宣布|表示|写道|叹道|低语|耳语|吼道|笑道)[^。！？!?]*[：:]\s*$"
)
INLINE_QUOTE_LEFT_PATTERN = re.compile(
    r"(?:叫作|叫做|名为|称为|命名为|写着|写有|标着|挂着|所谓|提到|看见|看到|读作|标题是|名称是|称[^。！？!?；;]{0,12}为)\s*$"
)
INLINE_QUOTE_RIGHT_PATTERN = re.compile(r"^(?:的|之|这个|这项|这种|这类|一词|一语|等|所|被称|叫作|叫做)")
INLINE_QUOTED_TEXT_PATTERN = re.compile(
    r"\s*(?:“([^“”\n]{1,24})”|\"([^\"\n]{1,24})\"|‘([^‘’\n]{1,24})’|「([^「」\n]{1,24})」|『([^『』\n]{1,24})』)\s*"
)
SPEECH_CUE_PATTERN = re.compile(
    r"(?:说|说道|道|问|问道|答|回答|回应|喊|叫|低语|耳语|吼|笑)(?:了)?(?:一|这|那)?(?:声|句)?\s*[：:]?\s*$"
)
ROLE_REFERENCE_TERMS = (
    "老板娘", "女老板", "店老板", "店主", "老板", "教授", "老师", "医生", "护士", "警察", "刑警",
    "组长", "队长", "记者", "主播", "妻子", "丈夫", "母亲", "父亲", "妇人", "女子", "男人", "女人",
)
QUOTE_TRANSLATION = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "„": '"', "‟": '"'})

ROLE_HEADERS = ["轨道ID", "角色", "类型", "角色说明", "音色预设或高级提示", "音色ID", "角色节奏预设", "重新生成"]
SEGMENT_HEADERS = [
    "序号",
    "章节",
    "轨道ID",
    "角色",
    "语言",
    "原文片段",
    "合成文本",
    "态度预设",
    "情绪预设",
    "情绪强度",
    "句内节奏预设",
    "句后停顿ms",
    "情绪演绎预设",
    "情绪细化描述",
    "重音文字",
    "重音出现序号",
    "重音强度",
    "生成方式",
]

DIRECTOR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["content_type", "title", "characters", "scenes", "segments"],
    "properties": {
        "content_type": {"type": "string", "enum": sorted(ANALYZED_CONTENT_TYPES)},
        "title": {"type": "string"},
        "characters": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "name", "kind", "aliases", "profile", "voice_hint", "gender", "gender_evidence", "age", "age_evidence", "confidence", "evidence"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "kind": {"type": "string", "enum": sorted(ROLE_KINDS)},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "profile": {"type": "string"},
                    "voice_hint": {"type": "string"},
                    "gender": {"type": "string", "enum": ["female", "male", "unspecified"]},
                    "gender_evidence": {"type": "string"},
                    "gender_basis": {"type": "string", "enum": ["current_explicit", "linked_explicit", "current_inference", "linked_inference", "unknown"]},
                    "age": {"anyOf": [{"type": "integer", "minimum": 5, "maximum": 100}, {"type": "null"}]},
                    "age_evidence": {"type": "string"},
                    "age_basis": {"type": "string", "enum": ["current_explicit", "linked_explicit", "current_inference", "linked_inference", "unknown"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "evidence": {"type": "string"},
                },
            },
        },
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "title",
                    "topic",
                    "location",
                    "spatial_direction",
                    "time",
                    "participants",
                    "narrative_perspective",
                    "mood",
                    "storyboard_note",
                    "boundary_reason",
                    "evidence",
                ],
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "topic": {"type": "string"},
                    "location": {"type": "string"},
                    "spatial_direction": {"type": "string"},
                    "time": {"type": "string"},
                    "participants": {"type": "array", "items": {"type": "string"}},
                    "narrative_perspective": {"type": "string"},
                    "mood": {"type": "string"},
                    "storyboard_note": {"type": "string"},
                    "boundary_reason": {"type": "string"},
                    "evidence": {"type": "string"},
                },
            },
        },
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "order",
                    "section",
                    "speaker_id",
                    "speaker_name",
                    "speaker_kind",
                    "speaker_candidates",
                    "speaker_confidence",
                    "speaker_evidence",
                    "scene_id",
                    "language",
                    "source_text",
                    "text",
                    "attitude",
                    "emotion",
                    "intensity",
                    "pace",
                    "pause_after_ms",
                ],
                "properties": {
                    "order": {"type": "integer"},
                    "section": {"type": "string"},
                    "speaker_id": {"type": "string"},
                    "speaker_name": {"type": "string"},
                    "speaker_kind": {"type": "string", "enum": sorted(ROLE_KINDS)},
                    "speaker_candidates": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
                    "speaker_confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "speaker_evidence": {"type": "string"},
                    "scene_id": {"type": "string"},
                    "language": {"type": "string", "enum": sorted(LANGUAGES)},
                    "source_text": {"type": "string"},
                    "text": {"type": "string"},
                    "attitude": {"type": "string", "enum": sorted(ATTITUDE_PRESETS)},
                    "emotion": {"type": "string", "enum": sorted(EMOTIONS)},
                    "intensity": {"type": "number", "minimum": 0, "maximum": 1},
                    "pace": {"type": "string", "enum": sorted(PACE_PRESETS)},
                    "pause_after_ms": {"type": "integer", "minimum": 0, "maximum": 3000},
                },
            },
        },
    },
}

GUIDANCE_ROUTING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["assignments"],
    "properties": {
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["clause_index", "scope", "target_role_ids", "instruction", "reason"],
                "properties": {
                    "clause_index": {"type": "integer", "minimum": 1},
                    "scope": {"type": "string", "enum": ["global", "roles"]},
                    "target_role_ids": {"type": "array", "items": {"type": "string"}},
                    "instruction": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        }
    },
}

CONTEXT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["content_type", "title", "characters", "scenes"],
    "properties": {
        "content_type": deepcopy(DIRECTOR_SCHEMA["properties"]["content_type"]),
        "title": deepcopy(DIRECTOR_SCHEMA["properties"]["title"]),
        "characters": deepcopy(DIRECTOR_SCHEMA["properties"]["characters"]),
        "scenes": deepcopy(DIRECTOR_SCHEMA["properties"]["scenes"]),
    },
}

CONTENT_CLASSIFICATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["content_type", "title", "reason"],
    "properties": {
        "content_type": {"type": "string", "enum": sorted(ANALYZED_CONTENT_TYPES)},
        "title": {"type": "string"},
        "reason": {"type": "string"},
    },
}


class DirectorError(RuntimeError):
    pass


class DirectorCancelled(DirectorError):
    pass


class DirectorTimeout(DirectorError):
    pass


class DirectorValidationError(DirectorError):
    pass


class DirectorServiceError(DirectorError):
    pass


MIN_ADAPTIVE_CHUNK_CHARS = 320
DEMOGRAPHIC_BASIS_PRIORITY = {
    "unknown": 0,
    "linked_inference": 1,
    "current_inference": 2,
    "linked_explicit": 3,
    "current_explicit": 4,
}

CHARACTER_VALIDATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["all_valid", "summary", "characters"],
    "properties": {
        "all_valid": {"type": "boolean"},
        "summary": {"type": "string"},
        "characters": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id", "canonical_id", "name", "status", "issues",
                    "profile", "profile_evidence", "gender", "gender_evidence",
                    "gender_basis", "age", "age_evidence", "age_basis",
                ],
                "properties": {
                    "id": {"type": "string"},
                    "canonical_id": {"type": "string"},
                    "name": {"type": "string"},
                    "status": {"type": "string", "enum": ["pass", "corrected", "uncertain"]},
                    "issues": {"type": "array", "items": {"type": "string"}},
                    "profile": {"type": "string"},
                    "profile_evidence": {"type": "string"},
                    "gender": {"type": "string", "enum": ["female", "male", "unspecified"]},
                    "gender_evidence": {"type": "string"},
                    "gender_basis": {"type": "string", "enum": ["current_explicit", "linked_explicit", "current_inference", "linked_inference", "unknown"]},
                    "age": {"type": "integer", "minimum": 5, "maximum": 100},
                    "age_evidence": {"type": "string"},
                    "age_basis": {"type": "string", "enum": ["current_explicit", "linked_explicit", "current_inference", "linked_inference", "unknown"]},
                },
            },
        },
    },
}


STORYBOARD_SHOT_AUTHORING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["shots"],
    "properties": {
        "shots": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "title", "storyboard_note", "source_evidence", "participant_ids"],
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "storyboard_note": {"type": "string"},
                    "source_evidence": {"type": "string"},
                    "participant_ids": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}


@dataclass(frozen=True)
class DirectorConfig:
    base_url: str = "http://127.0.0.1:11434"
    model: str = "qwen3:14b"
    timeout_seconds: int = 600
    max_chunk_chars: int = 1400
    provider: str = "ollama"
    api_key: str = ""
    instance_id: str = ""
    text_api: str = "chat_completions"
    allow_insecure_http: bool = False
    staged_analysis: bool = False


def _notify(progress: Callable[..., Any] | None, fraction: float, description: str) -> None:
    if progress is None:
        return
    try:
        progress(fraction, desc=description)
    except TypeError:
        progress(fraction, description)


def normalize_source_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def coverage_key(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def split_guidance_clauses(guidance: str) -> list[str]:
    return [item.strip() for item in re.split(r"[，,。；;！？!?\n]+", str(guidance or "")) if item.strip()]


def guidance_role_roster(role_table: Any) -> list[dict[str, str]]:
    return [
        {"role_id": str(row[0]), "name": str(row[1]), "kind": str(row[2]), "profile": str(row[3]), "voice_hint": str(row[4])}
        for row in _table_rows(role_table)
        if len(row) >= 5
    ]


def guidance_role_signature(role_table: Any) -> str:
    return hashlib.sha256(json.dumps(guidance_role_roster(role_table), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def validate_guidance_assignments(raw: Any, clauses: list[str], roster: list[dict[str, str]]) -> list[dict[str, Any]]:
    raw_assignments = raw.get("assignments") if isinstance(raw, dict) else None
    if not isinstance(raw_assignments, list):
        raise DirectorValidationError("导演补充语义分配缺少 assignments。")
    role_ids = [item["role_id"] for item in roster]
    role_by_id = {item["role_id"]: item for item in roster}
    kind_labels = {"narrator": "旁白", "anchor": "主播", "reporter": "记者", "interviewee": "采访对象"}
    by_index: dict[int, dict[str, Any]] = {}
    for item in raw_assignments:
        if not isinstance(item, dict):
            raise DirectorValidationError("导演补充语义分配项格式无效。")
        clause_index = int(item.get("clause_index") or 0)
        if clause_index < 1 or clause_index > len(clauses) or clause_index in by_index:
            raise DirectorValidationError("导演补充语义分配的 clause_index 重复或越界。")
        source_text = clauses[clause_index - 1]
        scope = str(item.get("scope") or "")
        targets = list(dict.fromkeys(str(value) for value in (item.get("target_role_ids") or [])))
        explicit_targets = {
            role["role_id"]
            for role in roster
            if role["name"] in source_text or (kind_labels.get(role["kind"], "") and kind_labels[role["kind"]] in source_text)
        }
        if scope == "global":
            if explicit_targets:
                names = "、".join(role_by_id[target]["name"] for target in explicit_targets)
                raise DirectorValidationError(f"导演补充第 {clause_index} 项明确指向 {names}，不能分配为 global。")
            targets = list(role_ids)
        elif scope != "roles" or not targets:
            raise DirectorValidationError(f"导演补充第 {clause_index} 项缺少有效作用域。")
        unknown = [target for target in targets if target not in role_ids]
        if unknown:
            raise DirectorValidationError(f"导演补充第 {clause_index} 项包含未知角色：{'、'.join(unknown)}")
        missing_explicit = explicit_targets.difference(targets)
        if missing_explicit:
            names = "、".join(role_by_id[target]["name"] for target in missing_explicit)
            raise DirectorValidationError(f"导演补充第 {clause_index} 项漏掉明确点名角色：{names}")
        instruction = str(item.get("instruction") or "").strip()
        if not instruction:
            raise DirectorValidationError(f"导演补充第 {clause_index} 项缺少可执行指令。")
        by_index[clause_index] = {
            "clause_index": clause_index,
            "source_text": source_text,
            "scope": scope,
            "target_role_ids": targets,
            "target_role_names": [role_by_id[target]["name"] for target in targets],
            "instruction": instruction,
            "reason": str(item.get("reason") or "").strip(),
        }
    if sorted(by_index) != list(range(1, len(clauses) + 1)):
        raise DirectorValidationError("导演补充语义分配未完整覆盖全部输入片段。")
    return [by_index[index] for index in sorted(by_index)]


def canonical_coverage_key(text: str) -> str:
    return coverage_key(text).translate(QUOTE_TRANSLATION)


def restore_exact_source_text(segments: list[dict[str, Any]], source: str) -> bool:
    """Restore exact source slices when the model only normalized whitespace or quotes."""
    model_key = canonical_coverage_key("".join(segment["source_text"] for segment in segments))
    if model_key != canonical_coverage_key(source):
        return False

    cursor = 0
    for index, segment in enumerate(segments):
        if index == len(segments) - 1:
            end = len(source)
        else:
            required = len(canonical_coverage_key(segment["source_text"]))
            consumed = 0
            end = cursor
            while end < len(source) and consumed < required:
                if not source[end].isspace():
                    consumed += 1
                end += 1
            if consumed != required:
                return False
        segment["source_text"] = source[cursor:end]
        cursor = end
    return cursor == len(source)


def is_speech_attribution(text: str) -> bool:
    source = (text or "").strip()
    return bool(ATTRIBUTION_PATTERN.search(source)) and not any(mark in source for mark in "。！？!?")


def split_document(text: str, max_chars: int = 1400) -> list[str]:
    source = normalize_source_text(text)
    if not source:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(source):
        end = min(start + max_chars, len(source))
        if end < len(source):
            lower_bound = start + int(max_chars * 0.55)
            candidates = [
                source.rfind("\n\n", lower_bound, end),
                source.rfind("\n", lower_bound, end),
                max(source.rfind(mark, lower_bound, end) for mark in "。！？!?；;"),
            ]
            boundary = max(candidates)
            if boundary >= lower_bound:
                end = boundary + (2 if source[boundary : boundary + 2] == "\n\n" else 1)
                while end < len(source) and source[end] in "”’」』】）)]\"'":
                    end += 1
                while end < len(source) and source[end].isspace():
                    end += 1
        chunk = source[start:end]
        if chunk:
            chunks.append(chunk)
        start = end
    return chunks


def split_exact_sentences(text: str) -> list[str]:
    source = str(text or "")
    if not source:
        return []
    slices: list[str] = []
    start = 0
    index = 0
    while index < len(source):
        character = source[index]
        if character in "。！？!?；;\n":
            end = index + 1
            while end < len(source) and source[end] in "”’」』】）)]\"'":
                end += 1
            while end < len(source) and source[end].isspace():
                end += 1
            piece = source[start:end]
            if piece.strip():
                slices.append(piece)
            start = end
            index = end
            continue
        index += 1
    if start < len(source):
        tail = source[start:]
        if tail.strip():
            slices.append(tail)
        elif slices:
            slices[-1] += tail
    return slices or [source]


class OllamaTextDirector:
    def __init__(self, config: DirectorConfig):
        self.config = config
        self.base_url = config.base_url.rstrip("/")
        if config.provider not in {"ollama", "compatible"}:
            raise DirectorError(f"不支持的 AI Provider：{config.provider}")
        if config.text_api not in {"chat_completions", "responses"}:
            raise DirectorError(f"不支持的文本接口：{config.text_api}")
        parsed = urlparse(self.base_url)
        if config.provider == "compatible" and parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"} and not config.allow_insecure_http:
            raise DirectorError("兼容 Endpoint 使用公网 HTTP，必须改用 HTTPS 或在全局设置中明确允许该传输风险")

    def _compatible_route(self, route: str) -> str:
        return f"{self.base_url}{'' if self.base_url.endswith('/v1') else '/v1'}{route}"

    def _compatible_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
            **({"X-Cockpit-Instance-Id": self.config.instance_id} if self.config.instance_id else {}),
        }

    def list_models(self) -> list[str]:
        try:
            if self.config.provider == "ollama":
                response = requests.get(f"{self.base_url}/api/tags", timeout=10)
            else:
                response = requests.get(
                    self._compatible_route("/models"),
                    headers=self._compatible_headers(),
                    timeout=10,
                )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise DirectorError(f"无法连接 AI 服务 {self.base_url}：{exc}") from exc
        payload = response.json()
        rows = payload.get("models", []) if self.config.provider == "ollama" else payload.get("data", payload.get("models", []))
        return sorted({str(item.get("name") or item.get("id") or "").strip() for item in rows if item.get("name") or item.get("id")})

    def health_summary(self) -> str:
        models = self.list_models()
        if self.config.model not in models:
            available = "、".join(models) if models else "无"
            raise DirectorError(f"AI 模型 {self.config.model} 不可用。当前模型：{available}")
        provider_label = "本地 Ollama" if self.config.provider == "ollama" else "兼容 Endpoint"
        return f"{provider_label} 已连接｜{self.config.model}｜{self.base_url}"

    def author_storyboard_shots(
        self,
        document: dict[str, Any],
        progress: Callable[..., Any] | None = None,
        batch_size: int = 8,
    ) -> dict[str, Any]:
        authored = deepcopy(document)
        character_rows = [
            item for item in authored.get("characters") or []
            if isinstance(item, dict) and item.get("id")
        ]
        characters = {
            str(item.get("id") or ""): str(item.get("name") or item.get("id") or "")
            for item in character_rows
        }
        character_aliases = {
            str(item.get("id") or ""): [
                value for value in [str(item.get("name") or "").strip(), *(str(alias).strip() for alias in item.get("aliases") or [])]
                if value
            ]
            for item in character_rows
        }
        short_alias_owners: dict[str, list[str]] = {}
        for role_id, name in characters.items():
            if role_id != "narrator" and re.fullmatch(r"[\u3400-\u9fff]{3,}", name):
                short_alias_owners.setdefault(name[:2], []).append(role_id)
        for alias, owners in short_alias_owners.items():
            if len(owners) == 1 and alias not in character_aliases[owners[0]]:
                character_aliases[owners[0]].append(alias)
        pending: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for scene in authored.get("scenes") or []:
            if not isinstance(scene, dict):
                continue
            for shot in scene.get("shots") or []:
                if not isinstance(shot, dict):
                    continue
                shot_id = str(shot.get("id") or "").strip()
                source_text = str(shot.get("source_text") or shot.get("source_excerpt") or "").strip()
                if not shot_id:
                    raise DirectorValidationError("分镜镜头缺少稳定 ID，无法撰写镜头画面小记")
                if not source_text:
                    raise DirectorValidationError(f"分镜镜头 {shot_id} 缺少对应原文，无法撰写镜头画面小记")
                pending.append((scene, shot))
        if not pending:
            raise DirectorValidationError("当前分镜没有可供 AI 撰写画面小记的镜头")

        required_characters_by_shot: dict[str, set[str]] = {}
        last_explicit_by_scene: dict[str, list[str]] = {}
        for scene, shot in pending:
            scene_id = str(scene.get("id") or "")
            shot_id = str(shot.get("id") or "")
            source_text = str(shot.get("source_text") or shot.get("source_excerpt") or "")
            explicit = [
                role_id for role_id, aliases in character_aliases.items()
                if role_id != "narrator" and any(alias in source_text for alias in aliases)
            ]
            if explicit:
                last_explicit_by_scene[scene_id] = explicit
            continuity = (
                last_explicit_by_scene.get(scene_id, [])
                if not explicit and len(last_explicit_by_scene.get(scene_id, [])) == 1 and re.search(r"(?:他|她|他们|她们|其|自己|这位|那位)", source_text)
                else []
            )
            required_characters_by_shot[shot_id] = set([*explicit, *continuity])

        batch_size = max(1, min(12, int(batch_size or 8)))
        updates: dict[str, dict[str, Any]] = {}
        note_keys: set[str] = set()
        metrics = {"prompt_tokens": 0, "output_tokens": 0, "duration_seconds": 0.0, "requests": 0}
        _notify(progress, 0.0, f"正在准备 {len(pending)} 个镜头的独立画面小记")
        for offset in range(0, len(pending), batch_size):
            batch = pending[offset:offset + batch_size]
            inputs: list[dict[str, Any]] = []
            for scene, shot in batch:
                speaker_ids = [str(item) for item in shot.get("participants") or []]
                scene_participant_ids = [str(item) for item in scene.get("participants") or []]
                source_text = str(shot.get("source_text") or shot.get("source_excerpt") or "")
                explicit_character_ids = [
                    role_id for role_id in required_characters_by_shot[str(shot["id"])]
                    if any(alias in source_text for alias in character_aliases[role_id])
                ]
                continuity_character_ids = [
                    role_id for role_id in required_characters_by_shot[str(shot["id"])]
                    if role_id not in explicit_character_ids
                ]
                explicit_character_ids.sort()
                continuity_character_ids.sort()
                inputs.append({
                    "id": str(shot["id"]),
                    "start_segment_order": int(shot.get("start_segment_order") or 0),
                    "end_segment_order": int(shot.get("end_segment_order") or 0),
                    "start_seconds": shot.get("start_seconds"),
                    "end_seconds": shot.get("end_seconds"),
                    "source_text": source_text,
                    "explicit_character_ids": explicit_character_ids,
                    "continuity_character_ids": continuity_character_ids,
                    "speakers": [
                        {"id": role_id, "name": characters.get(role_id, role_id)}
                        for role_id in speaker_ids
                    ],
                    "scene_participants": [
                        {"id": role_id, "name": characters.get(role_id, role_id)}
                        for role_id in scene_participant_ids
                    ],
                    "scene": {
                        "id": str(scene.get("id") or ""),
                        "title": str(scene.get("title") or ""),
                        "topic": str(scene.get("topic") or ""),
                        "location": str(scene.get("location") or ""),
                        "spatial_direction": str(scene.get("spatial_direction") or ""),
                        "time": str(scene.get("time") or ""),
                        "narrative_perspective": str(scene.get("narrative_perspective") or ""),
                        "mood": str(scene.get("mood") or ""),
                    },
                })
            prompt = f"""
你是视频分镜导演。请逐个读取每个镜头自己的 source_text，为每个稳定镜头 ID 撰写独立的镜头标题和画面小记。

要求：
1. 返回项必须与输入 ID 一一对应，完整覆盖，顺序保持一致。
2. 每个 storyboard_note 使用 80 到 220 个中文字符，描述这个镜头可见的主体、人物动作与位置、前后景、构图、景别或机位、光线、色彩和关键物件。
3. 场景字段只提供连续性背景。镜头动作、视觉焦点和关键物件必须从当前镜头自己的 source_text 提取，禁止复制场景级小记，禁止为不同镜头复用同一句画面描述。
4. source_evidence 必须原样摘录当前镜头 source_text 中能直接支持画面的连续文字，不能改写，也不能引用其他镜头原文。
5. participant_ids 只填写当前镜头画面中实际可见的已登记人物稳定 ID。registered_characters 提供全工程人物 ID、名称和别名映射，speakers 只是声音线索，scene_participants 是场景分析候选；应根据当前 source_text 中出现的姓名、代词和连续上下文选择人物。explicit_character_ids 是当前原文明示人物，continuity_character_ids 是场景内代词连续指向的人物，两组 ID 都必须全部包含。旁白 narrator 不得作为画面人物。两组都为空且没有可见人物时返回空数组。
6. 原文只写心理、判断或抽象叙述时，使用原文支持的表情、姿态、环境或物件表现，不虚构新事件。
7. 不写字幕、对白文字、水印、界面或多格拼图。未知的服饰、外貌和环境细节保持克制。

镜头输入：
{json.dumps({"registered_characters": [{"id": str(item.get("id") or ""), "name": str(item.get("name") or ""), "aliases": character_aliases[str(item.get("id") or "")], "kind": str(item.get("kind") or "")} for item in character_rows], "shots": inputs}, ensure_ascii=False, indent=2)}
""".strip()
            expected_ids = [str(shot["id"]) for _, shot in batch]
            source_by_id = {
                str(shot["id"]): str(shot.get("source_text") or shot.get("source_excerpt") or "")
                for _, shot in batch
            }
            validation_feedback = ""
            for attempt in range(1, 4):
                attempt_prompt = prompt if not validation_feedback else f"{prompt}\n\n上一次输出未通过校验：{validation_feedback}\n请完整重写当前批次全部镜头，逐项修正并确保每条画面小记包含至少 80 个中文字符。"
                result, current_metrics = self._request_structured(
                    attempt_prompt,
                    STORYBOARD_SHOT_AUTHORING_SCHEMA,
                    system="你只输出严格符合 JSON Schema 的逐镜头画面小记，逐项消费对应原文。",
                    schema_name="storyboard_shot_authoring",
                    context_tokens=8192,
                    keep_alive="30m",
                )
                metrics["prompt_tokens"] += current_metrics["prompt_tokens"]
                metrics["output_tokens"] += current_metrics["output_tokens"]
                metrics["duration_seconds"] += current_metrics["duration_seconds"]
                metrics["requests"] += 1
                try:
                    rows = result.get("shots") if isinstance(result, dict) else None
                    if not isinstance(rows, list):
                        raise DirectorValidationError("AI 镜头画面小记结果缺少 shots")
                    returned_ids = [str(item.get("id") or "").strip() for item in rows if isinstance(item, dict)]
                    if len(rows) != len(expected_ids) or len(set(returned_ids)) != len(returned_ids) or set(returned_ids) != set(expected_ids):
                        raise DirectorValidationError("AI 镜头画面小记未按稳定 ID 完整覆盖当前批次")
                    batch_updates: dict[str, dict[str, Any]] = {}
                    batch_note_keys: set[str] = set()
                    for row in rows:
                        if not isinstance(row, dict):
                            raise DirectorValidationError("AI 镜头画面小记包含无效项")
                        shot_id = str(row.get("id") or "").strip()
                        title = str(row.get("title") or "").strip()
                        note = str(row.get("storyboard_note") or "").strip()
                        evidence = str(row.get("source_evidence") or "").strip()
                        participant_ids = list(dict.fromkeys(str(item).strip() for item in row.get("participant_ids") or [] if str(item).strip()))
                        if len(title) < 2 or len(title) > 60:
                            raise DirectorValidationError(f"镜头 {shot_id} 的 AI 标题长度无效")
                        if len(note) < 50 or len(note) > 320:
                            raise DirectorValidationError(f"镜头 {shot_id} 的 AI 画面小记必须包含足够的独立视觉信息")
                        evidence_key = canonical_coverage_key(evidence)
                        if not evidence_key or evidence_key not in canonical_coverage_key(source_by_id[shot_id]):
                            raise DirectorValidationError(f"镜头 {shot_id} 的 AI 取景证据不属于该镜头对应原文")
                        note_key = canonical_coverage_key(note).casefold()
                        if note_key in note_keys or note_key in batch_note_keys:
                            raise DirectorValidationError(f"镜头 {shot_id} 的 AI 画面小记与其他镜头完全重复")
                        unknown_participants = [role_id for role_id in participant_ids if role_id not in characters]
                        if unknown_participants:
                            raise DirectorValidationError(f"镜头 {shot_id} 的 AI 画面人物包含未登记角色：{'、'.join(unknown_participants)}")
                        if "narrator" in participant_ids:
                            raise DirectorValidationError(f"镜头 {shot_id} 把旁白错误地列为画面人物")
                        for role_id in sorted(required_characters_by_shot[shot_id]):
                            if role_id not in participant_ids:
                                participant_ids.append(role_id)
                        batch_note_keys.add(note_key)
                        batch_updates[shot_id] = {
                            "title": title,
                            "storyboard_note": note,
                            "source_evidence": evidence,
                            "participants": participant_ids,
                            "participant_resolution": "ai_plus_source_continuity",
                        }
                except DirectorValidationError as exc:
                    validation_feedback = str(exc)
                    if attempt == 3:
                        raise
                    _notify(progress, offset / len(pending), f"AI 镜头小记第 {attempt} 次校验未通过，正在重写当前批次")
                    continue
                updates.update(batch_updates)
                note_keys.update(batch_note_keys)
                break
            completed = min(offset + len(batch), len(pending))
            _notify(progress, completed / len(pending), f"AI 已撰写 {completed}/{len(pending)} 个独立镜头画面小记")

        for _, shot in pending:
            shot.update(updates[str(shot["id"])])
            shot["authoring"] = "ai_shot_source"
        regeneration = dict(authored.get("storyboard_regeneration") or {})
        regeneration.update({
            "shot_notes_authored_by_ai": True,
            "shot_note_count": len(updates),
            "shot_note_provider": self.config.provider,
            "shot_note_model": self.config.model,
            "shot_note_metrics": metrics,
        })
        authored["storyboard_regeneration"] = regeneration
        return authored

    def analyze_document(
        self,
        text: str,
        content_type: str = "auto",
        guidance: str = "",
        progress: Callable[..., Any] | None = None,
        demographic_reference_text: str = "",
    ) -> dict[str, Any]:
        source = normalize_source_text(text)
        if not source:
            raise DirectorError("请输入需要处理的完整文字。")
        if content_type not in {"auto", *ANALYZED_CONTENT_TYPES}:
            raise DirectorError(f"不支持的内容体裁：{content_type}")

        chunks = split_document(source, self.config.max_chunk_chars)
        if not chunks:
            raise DirectorError("输入文字没有可处理内容。")

        global_characters: list[dict[str, Any]] = []
        global_scenes: list[dict[str, Any]] = []
        global_segments: list[dict[str, Any]] = []
        detected_type: str | None = None
        title = "未命名内容"
        metrics = {
            "prompt_tokens": 0,
            "output_tokens": 0,
            "duration_seconds": 0.0,
            "chunks": 0,
            "fallback_chunks": 0,
            "context_requests": 0,
            "context_fallback": 0,
            "classification_requests": 0,
        }
        resolved_type = content_type
        classification_reason = "使用者已指定作品体裁"
        if content_type == "auto":
            _notify(progress, 0.005, "AI 正在判断稿件类型")
            classification, classification_metrics = self._classify_content_type(source)
            resolved_type = classification["content_type"]
            title = classification["title"] or title
            classification_reason = classification["reason"]
            metrics["prompt_tokens"] += classification_metrics["prompt_tokens"]
            metrics["output_tokens"] += classification_metrics["output_tokens"]
            metrics["duration_seconds"] += classification_metrics["duration_seconds"]
            metrics["classification_requests"] = 1
        single_anchor = resolved_type in SINGLE_ANCHOR_CONTENT_TYPES
        if single_anchor:
            global_characters = [self._single_anchor_character()]
            _notify(progress, 0.01, f"稿件类型为 {CONTENT_TYPE_LABELS[resolved_type]}，采用单主播分析")
        elif self.config.staged_analysis:
            _notify(progress, 0.01, "AI 正在建立全文角色与场景注册表")
            try:
                global_characters, global_scenes, context_metrics = self._analyze_context(
                    source,
                    resolved_type,
                    guidance,
                    demographic_reference_text,
                )
                metrics["prompt_tokens"] += context_metrics["prompt_tokens"]
                metrics["output_tokens"] += context_metrics["output_tokens"]
                metrics["duration_seconds"] += context_metrics["duration_seconds"]
                metrics["context_requests"] = context_metrics["requests"]
            except (DirectorError, ValueError, TypeError, json.JSONDecodeError):
                metrics["context_fallback"] = 1
                global_characters = []
                global_scenes = []
                _notify(progress, 0.02, "全文角色与场景注册未通过校验，继续使用逐块识别并标记待复核")
        self._scene_registry = global_scenes
        previous_context = ""
        index = 0
        while index < len(chunks):
            chunk = chunks[index]
            _notify(progress, index / len(chunks), f"AI 正在导演第 {index + 1}/{len(chunks)} 个文本块")
            try:
                result, result_metrics = self._analyze_chunk(
                    chunk=chunk,
                    chunk_index=index + 1,
                    chunk_count=len(chunks),
                    requested_type=resolved_type,
                    existing_characters=global_characters,
                    previous_context=previous_context,
                    guidance=guidance,
                    single_anchor=single_anchor,
                )
            except (DirectorTimeout, DirectorValidationError) as exc:
                failure_kind = "超时" if isinstance(exc, DirectorTimeout) else "覆盖校验失败"
                if len(chunk) <= MIN_ADAPTIVE_CHUNK_CHARS:
                    result = self._fallback_chunk(chunk, resolved_type)
                    result_metrics = {
                        "prompt_tokens": 0,
                        "output_tokens": 0,
                        "duration_seconds": 0.0,
                        "fallback_chunks": 1,
                    }
                    _notify(
                        progress,
                        index / len(chunks),
                        f"第 {index + 1} 个最小文本块仍{failure_kind}，已使用无损安全分段继续处理",
                    )
                else:
                    smaller_chunks = split_document(
                        chunk,
                        max(MIN_ADAPTIVE_CHUNK_CHARS, len(chunk) // 2),
                    )
                    if len(smaller_chunks) < 2:
                        result = self._fallback_chunk(chunk, resolved_type)
                        result_metrics = {
                            "prompt_tokens": 0,
                            "output_tokens": 0,
                            "duration_seconds": 0.0,
                            "fallback_chunks": 1,
                        }
                        _notify(
                            progress,
                            index / len(chunks),
                            f"第 {index + 1} 个文本块无法继续自然拆分，已使用无损安全分段",
                        )
                    else:
                        chunks[index : index + 1] = smaller_chunks
                        _notify(
                            progress,
                            index / len(chunks),
                            f"第 {index + 1} 个文本块{failure_kind}，已按自然边界拆为 {len(smaller_chunks)} 个更小文本块",
                        )
                        continue
            metrics["prompt_tokens"] += result_metrics["prompt_tokens"]
            metrics["output_tokens"] += result_metrics["output_tokens"]
            metrics["duration_seconds"] += result_metrics["duration_seconds"]
            metrics["chunks"] += 1
            metrics["fallback_chunks"] += int(result_metrics.get("fallback_chunks", 0))
            if detected_type is None:
                detected_type = result["content_type"]
                title = result["title"].strip() or title
            self._merge_chunk(result, global_characters, global_segments, global_scenes)
            previous_context = chunk[-400:]
            index += 1

        global_segments = assign_numbered_chapter_sections(source, global_segments)
        for order, segment in enumerate(global_segments, start=1):
            segment["order"] = order
        global_scenes = self._finalize_scene_ranges(global_scenes, global_segments)

        _notify(progress, 1.0, "AI 文本导演完成")
        return {
            "version": 2,
            "provider": self.config.provider,
            "model": self.config.model,
            "content_type": detected_type or resolved_type,
            "content_type_analysis": {
                "requested": content_type,
                "resolved": resolved_type,
                "mode": "ai_classification" if content_type == "auto" else "user_selected",
                "reason": classification_reason,
                "single_anchor": single_anchor,
            },
            "title": title,
            "original_text": source,
            "cleaned_text": "\n".join(segment["text"] for segment in global_segments),
            "characters": global_characters,
            "scenes": global_scenes,
            "segments": global_segments,
            "metrics": metrics,
        }

    def _classify_content_type(self, source: str) -> tuple[dict[str, str], dict[str, Any]]:
        sample = source[:12000]
        prompt = f"""
你是有声稿件的体裁分类器。先判断整篇稿件采用哪一种分析管线。

分类标准：
1. novel：以虚构人物、对白、行动和连续情节为核心的小说。
2. story：以讲述事件或经历为核心，具有明显叙事推进，但不一定是小说。
3. news：以报道事实、事件、消息或资讯为核心，适合由一个主播完整播报。稿件中提到的人名不等于配音角色。
4. commentary：以观点、分析、评论、随笔、影评、社论或个人论述为核心，适合由一个主播完整播报。稿件中引用他人话语也不建立独立配音角色。
5. 只判断体裁、标题和简短依据，不分析人物，不推断年龄或性别。

稿件：
<<<SOURCE
{sample}
SOURCE
""".strip()
        result, metrics = self._request_structured(
            prompt,
            CONTENT_CLASSIFICATION_SCHEMA,
            system="你只输出严格符合 JSON Schema 的稿件体裁判断。",
            schema_name="content_classification",
            context_tokens=4096,
            keep_alive="30m",
        )
        resolved = str(result.get("content_type") or "")
        if resolved not in ANALYZED_CONTENT_TYPES:
            raise DirectorValidationError("AI 稿件类型判断缺少有效 content_type")
        return {
            "content_type": resolved,
            "title": str(result.get("title") or "").strip(),
            "reason": str(result.get("reason") or "").strip(),
        }, metrics

    @staticmethod
    def _single_anchor_character() -> dict[str, Any]:
        return {
            "id": "anchor",
            "name": "主播",
            "kind": "anchor",
            "aliases": [],
            "profile": "负责完整播报当前稿件的唯一主播，具体声音、年龄感、性别感和表达特征由使用者人工设置。",
            "voice_hint": "使用者尚未指定主播声音特征，先保留中性清晰的播报基线。",
            "gender": "unspecified",
            "gender_evidence": "单主播稿件不从文中人物推断主播性别",
            "gender_basis": "unknown",
            "age": None,
            "age_evidence": "单主播稿件不从文中人物推断主播年龄",
            "age_basis": "unknown",
            "confidence": 1.0,
            "evidence": "稿件体裁路由采用单主播管线",
        }

    @classmethod
    def _enforce_single_anchor_result(cls, result: dict[str, Any], content_type: str) -> dict[str, Any]:
        anchor = cls._single_anchor_character()
        scenes = deepcopy(result.get("scenes") or [])
        for scene in scenes:
            scene["participants"] = ["anchor"]
            if not str(scene.get("narrative_perspective") or "").strip():
                scene["narrative_perspective"] = "单主播播报"
        segments = deepcopy(result.get("segments") or [])
        for segment in segments:
            segment["speaker_id"] = "anchor"
            segment["speaker_name"] = "主播"
            segment["speaker_kind"] = "anchor"
            segment["speaker_candidates"] = ["anchor"]
            segment["speaker_confidence"] = 1.0
            segment["speaker_evidence"] = "新闻或评论采用唯一主播轨道"
        return {
            **result,
            "content_type": content_type,
            "characters": [anchor],
            "scenes": scenes,
            "segments": segments,
        }

    def validate_character_analysis(
        self,
        document: dict[str, Any],
        source_text: str,
        demographic_reference_text: str = "",
        max_rounds: int = 5,
        progress: Callable[..., Any] | None = None,
    ) -> dict[str, Any]:
        rounds: list[dict[str, Any]] = []
        max_rounds = max(1, min(5, int(max_rounds)))
        for round_index in range(1, max_rounds + 1):
            people = [item for item in document.get("characters") or [] if item.get("kind") == "character"]
            if not people:
                return {"all_valid": True, "round_count": 0, "rounds": [], "summary": "没有需要校验的人物"}
            _notify(progress, 0.9 + round_index * 0.015, f"AI 正在进行第 {round_index} 轮人物设定校验")
            current_evidence = self._character_validation_evidence(source_text, people)
            linked_evidence = self._character_validation_evidence(demographic_reference_text, people)
            roster = json.dumps(people, ensure_ascii=False, separators=(",", ":"))
            prompt = f"""
你是长篇作品的人物设定审校员。现在进行第 {round_index}/{max_rounds} 轮逐人校验。

必须逐一检查人物表中的每一个人物，任何人物都不能遗漏：
1. 校验规范名称、aliases 和人物关系，识别同一人物的简称、全名、关系称谓或译名差异。重复人物的 canonical_id 指向保留人物 ID，两个条目输出一致的修正人口属性。
2. 校验 age 是否符合原文明示年龄、年龄范围、就学阶段、亲属关系、职业阶段、时间线和行为。age 必须输出一个整数；原文给出 10 至 11 岁等范围时保存下限 10，并在 age_evidence 保留完整范围。禁止把 35 当作缺省值。
3. 校验 gender 是否符合称谓、亲属关系、代词、身份和上下文，证据不足时允许 unspecified。
4. 校验 profile 是否准确介绍身份、关系、行为、经历和叙事作用，删除原文不支持的断言，保留“稿件未说明”等不确定边界。profile 必须能让后续声音和形象生成正确理解人物。
5. 人口属性证据优先级为当前文章明示、关联文章明示、当前文章语境推断、关联文章语境推断。强证据不得被弱推断覆盖。关联文章已经明确写出年龄的人物，当前文章只有父亲、母亲、子女等关系身份时必须保留关联文章明示年龄。
6. age_basis 和 gender_basis 必须填写 current_explicit、linked_explicit、current_inference、linked_inference 或 unknown。
7. 当前文章没有直接写年龄数字或性别词本身不构成问题。只要已经使用最高优先级的可用证据，并由关联文章明示或文章语境得到合理结论，就应判为 pass。不得仅因证据来自关联文章、称谓、就学阶段、职业阶段或人物关系而填 uncertain 或重复报告 issue。
8. 发现真实错误时直接输出修正后的完整字段，status 填 corrected，并在 issues 说明原值问题。修正字段必须准确解决本轮 issues，下一轮不得继续报告已经修正的问题。只有证据相互冲突、无法选择合理结论时才填 uncertain。
9. 只有本轮每个人物都无需再修改、没有重复身份、没有 unresolved issue 时，所有 status 才能为 pass 且 all_valid 为 true。只要本轮进行了任何修正，all_valid 必须为 false，由下一轮复核修正结果。
10. characters 必须覆盖人物表全部 ID 且每个 ID 恰好一次。旁白不属于人物，本流程不校验旁白。

当前人物表：{roster}

当前文章人物证据：
<<<CURRENT_ARTICLE
{current_evidence or '无'}
CURRENT_ARTICLE

关联文章人物证据：
<<<LINKED_ARTICLES
{linked_evidence or '无'}
LINKED_ARTICLES
""".strip()
            expected_ids = {str(item.get("id") or "") for item in people}
            request_prompt = prompt
            repair_attempts = 0
            total_metrics = {"prompt_tokens": 0, "output_tokens": 0, "duration_seconds": 0.0}
            while True:
                result, metrics = self._request_structured(
                    request_prompt,
                    CHARACTER_VALIDATION_SCHEMA,
                    system="你只输出严格符合 JSON Schema 的逐人人物设定校验结果。",
                    schema_name="character_validation",
                    context_tokens=12288,
                    keep_alive="30m",
                )
                for key in total_metrics:
                    total_metrics[key] += metrics.get(key, 0)
                rows = result.get("characters")
                if not isinstance(rows, list):
                    raise DirectorValidationError(f"第 {round_index} 轮人物设定校验缺少 characters")
                actual_ids = [str(item.get("id") or "") for item in rows if isinstance(item, dict)]
                if len(actual_ids) != len(set(actual_ids)) or set(actual_ids) != expected_ids:
                    missing = sorted(expected_ids.difference(actual_ids))
                    extra = sorted(set(actual_ids).difference(expected_ids))
                    raise DirectorValidationError(f"第 {round_index} 轮人物设定校验覆盖不完整：缺少 {missing}，多出 {extra}")
                normalized_rows = [self._normalize_character_validation(item, expected_ids) for item in rows]
                reconciled_redundant_issues = self._reconcile_redundant_character_corrections(people, normalized_rows)
                inconsistencies = self._character_validation_inconsistencies(people, normalized_rows)
                if not inconsistencies:
                    break
                repair_attempts += 1
                if repair_attempts >= 3:
                    raise DirectorValidationError(f"第 {round_index} 轮 AI 声明修正但字段未落实：{inconsistencies}")
                _notify(progress, 0.9 + round_index * 0.015, f"第 {round_index} 轮修正未落实，正在要求 AI 重做")
                request_prompt = (
                    prompt
                    + "\n\n上一次输出存在下列自相矛盾，status 虽为 corrected，要求修正的字段却没有改变。"
                    + "请逐项重新比较当前人物表和 issue。若字段确实错误，必须真正修改对应字段；"
                    + "若当前字段已经满足 issue，例如 age 已为范围下限且 age_evidence 已保留完整范围，"
                    + "必须把该人物改判为 pass 并清空 issues，不得重复报告已经满足的要求。\n"
                    + json.dumps(inconsistencies, ensure_ascii=False)
                    + "\n上一次输出："
                    + json.dumps(result, ensure_ascii=False, separators=(",", ":"))
                )
            self._apply_character_validation(document, normalized_rows)
            statuses = {item["id"]: item["status"] for item in normalized_rows}
            round_valid = (
                (bool(result.get("all_valid")) or bool(reconciled_redundant_issues))
                and all(status == "pass" for status in statuses.values())
                and all(not item["issues"] for item in normalized_rows)
                and all(item["canonical_id"] == item["id"] for item in normalized_rows)
            )
            rounds.append({
                "round": round_index,
                "all_valid": round_valid,
                "summary": str(result.get("summary") or "").strip(),
                "statuses": statuses,
                "issues": {item["id"]: item["issues"] for item in normalized_rows if item["issues"]},
                "repair_attempts": repair_attempts,
                "reconciled_redundant_issues": reconciled_redundant_issues,
                "prompt_tokens": total_metrics["prompt_tokens"],
                "output_tokens": total_metrics["output_tokens"],
                "duration_seconds": total_metrics["duration_seconds"],
            })
            if round_valid:
                return {
                    "all_valid": True,
                    "round_count": round_index,
                    "rounds": rounds,
                    "summary": rounds[-1]["summary"],
                }
        unresolved = rounds[-1].get("issues") if rounds else {}
        raise DirectorValidationError(f"人物年龄、性别与小传经过 {max_rounds} 轮 AI 校验后仍未全部通过：{unresolved}")

    @staticmethod
    def _character_validation_evidence(source: str, people: list[dict[str, Any]], max_chars: int = 30000) -> str:
        source = normalize_source_text(str(source or ""))
        if len(source) <= max_chars:
            return source
        names = {
            str(value).strip()
            for person in people
            for value in [person.get("name"), *(person.get("aliases") or [])]
            if str(value or "").strip()
        }
        paragraphs = [item.strip() for item in source.split("\n") if item.strip()]
        selected: list[str] = []
        for index, paragraph in enumerate(paragraphs):
            if any(name in paragraph for name in names) or any(token in paragraph for token in ("岁", "年龄", "男孩", "女孩", "儿子", "女儿", "丈夫", "妻子", "父亲", "母亲")):
                for nearby in range(max(0, index - 1), min(len(paragraphs), index + 2)):
                    if paragraphs[nearby] not in selected:
                        selected.append(paragraphs[nearby])
        evidence = "\n".join(selected)
        return evidence[:max_chars]

    @staticmethod
    def _normalize_character_validation(raw: dict[str, Any], expected_ids: set[str]) -> dict[str, Any]:
        role_id = str(raw.get("id") or "").strip()
        canonical_id = str(raw.get("canonical_id") or role_id).strip()
        if canonical_id not in expected_ids:
            raise DirectorValidationError(f"人物 {role_id} 的 canonical_id 无效：{canonical_id}")
        status = str(raw.get("status") or "uncertain")
        if status not in {"pass", "corrected", "uncertain"}:
            status = "uncertain"
        age = raw.get("age")
        if not isinstance(age, int) or isinstance(age, bool) or not 5 <= age <= 100:
            raise DirectorValidationError(f"人物 {role_id} 的校验年龄无效")
        profile = str(raw.get("profile") or "").strip()
        if len(profile) < 10:
            raise DirectorValidationError(f"人物 {role_id} 的校验小传过短")
        profile_evidence = str(raw.get("profile_evidence") or "").strip()
        age_evidence = str(raw.get("age_evidence") or "").strip()
        gender = str(raw.get("gender") or "unspecified")
        gender_evidence = str(raw.get("gender_evidence") or "").strip()
        age_basis = str(raw.get("age_basis") or "unknown")
        gender_basis = str(raw.get("gender_basis") or "unknown")
        if not profile_evidence or not age_evidence:
            raise DirectorValidationError(f"人物 {role_id} 的小传或年龄缺少校验证据")
        if gender not in {"female", "male", "unspecified"}:
            raise DirectorValidationError(f"人物 {role_id} 的校验性别无效")
        if gender != "unspecified" and not gender_evidence:
            raise DirectorValidationError(f"人物 {role_id} 的性别缺少校验证据")
        if age_basis not in DEMOGRAPHIC_BASIS_PRIORITY or age_basis == "unknown":
            raise DirectorValidationError(f"人物 {role_id} 的年龄证据类型无效")
        if gender_basis not in DEMOGRAPHIC_BASIS_PRIORITY:
            raise DirectorValidationError(f"人物 {role_id} 的性别证据类型无效")
        return {
            "id": role_id,
            "canonical_id": canonical_id,
            "name": str(raw.get("name") or "").strip(),
            "status": status,
            "issues": [str(item).strip() for item in raw.get("issues") or [] if str(item).strip()],
            "profile": profile,
            "profile_evidence": profile_evidence,
            "gender": gender,
            "gender_evidence": gender_evidence,
            "gender_basis": gender_basis,
            "age": age,
            "age_evidence": age_evidence,
            "age_basis": age_basis,
        }

    @staticmethod
    def _reconcile_redundant_character_corrections(
        people: list[dict[str, Any]],
        rows: list[dict[str, Any]],
    ) -> list[str]:
        before = {str(item.get("id") or ""): item for item in people}
        reconciled: list[str] = []
        age_range_pattern = re.compile(
            r"(?:\d{1,3}|[零〇一二两三四五六七八九十百]+)\s*(?:至|到|[-~～])\s*"
            r"(?:\d{1,3}|[零〇一二两三四五六七八九十百]+)"
        )
        for row in rows:
            if row["status"] != "corrected" or not row["issues"]:
                continue
            original = before[row["id"]]
            changed = any(
                row.get(field) != original.get(field)
                for field in (
                    "name", "profile", "profile_evidence", "gender", "gender_evidence",
                    "gender_basis", "age", "age_evidence", "age_basis",
                )
            ) or row["canonical_id"] != row["id"]
            if changed or not age_range_pattern.search(row["age_evidence"]):
                continue
            requested_ages: list[int] = []
            only_resolved_age_issues = True
            for issue in row["issues"]:
                if any(token in issue for token in ("性别", "gender", "小传", "profile", "姓名", "name", "重复", "合并", "canonical")):
                    only_resolved_age_issues = False
                    break
                match = re.search(
                    r"(?:下限|年龄(?:值)?(?:应为|改为)|age\s*(?:应为|改为|=|should\s+be))\s*[:：]?\s*(\d{1,3})",
                    issue,
                    flags=re.IGNORECASE,
                )
                if not match:
                    only_resolved_age_issues = False
                    break
                requested_ages.append(int(match.group(1)))
            if only_resolved_age_issues and requested_ages and all(age == row["age"] for age in requested_ages):
                reconciled.append(f"{row['id']} 的年龄目标已为 {row['age']}，且 age_evidence 已保留范围")
                row["status"] = "pass"
                row["issues"] = []
        return reconciled

    @staticmethod
    def _character_validation_inconsistencies(
        people: list[dict[str, Any]],
        rows: list[dict[str, Any]],
    ) -> list[str]:
        before = {str(item.get("id") or ""): item for item in people}
        inconsistencies: list[str] = []
        for row in rows:
            if row["status"] != "corrected":
                continue
            original = before[row["id"]]
            issue_text = " ".join(row["issues"])
            changed = any(
                row.get(field) != original.get(field)
                for field in ("name", "profile", "gender", "gender_evidence", "gender_basis", "age", "age_evidence", "age_basis")
            ) or row["canonical_id"] != row["id"]
            if not changed:
                inconsistencies.append(f"{row['id']} 标记 corrected，但没有任何字段变化：{issue_text}")
            age_value_issue_text = re.sub(
                r"age_(?:basis|evidence)|年龄(?:证据类型|证据|依据|来源)",
                "",
                issue_text,
                flags=re.IGNORECASE,
            )
            requested_age_match = re.search(
                r"(?:下限|年龄(?:值)?(?:应为|改为)|age\s*(?:应为|改为|=|should\s+be))\s*[:：]?\s*(\d{1,3})",
                age_value_issue_text,
                flags=re.IGNORECASE,
            )
            requested_age = int(requested_age_match.group(1)) if requested_age_match else None
            age_value_change_required = (
                any(token in age_value_issue_text for token in ("年龄", "age", "岁"))
                and any(token in age_value_issue_text for token in ("应为", "改为", "下限", "不是", "错误", "不合理"))
                and (requested_age is None or requested_age != row["age"])
            )
            if age_value_change_required and row["age"] == original.get("age"):
                target = f"，issue 要求 age={requested_age}" if requested_age is not None else ""
                inconsistencies.append(f"{row['id']} 的 issue 要求修改年龄值，age 仍为 {row['age']}{target}：{issue_text}")
            gender_value_issue_text = re.sub(
                r"gender_(?:basis|evidence)|性别(?:证据类型|证据|依据|来源)",
                "",
                issue_text,
                flags=re.IGNORECASE,
            )
            gender_value_change_required = (
                any(token in gender_value_issue_text for token in ("性别", "gender"))
                and any(token in gender_value_issue_text for token in ("应为", "改为", "错误", "不合理"))
            )
            if gender_value_change_required and row["gender"] == original.get("gender"):
                inconsistencies.append(f"{row['id']} 的 issue 要求修改性别值，gender 仍为 {row['gender']}：{issue_text}")
        return inconsistencies

    @staticmethod
    def _apply_character_validation(document: dict[str, Any], rows: list[dict[str, Any]]) -> None:
        characters = {str(item.get("id") or ""): item for item in document.get("characters") or []}
        mapping = {row["id"]: row["canonical_id"] for row in rows}
        for role_id, canonical_id in mapping.items():
            if mapping.get(canonical_id, canonical_id) != canonical_id:
                raise DirectorValidationError(f"人物合并目标必须是稳定根 ID：{role_id} -> {canonical_id}")
        for row in rows:
            character = characters[row["id"]]
            if row["name"]:
                character["name"] = row["name"]
            for field in ("profile", "gender", "gender_evidence", "gender_basis", "age", "age_evidence", "age_basis"):
                character[field] = row[field]
            character["profile_evidence"] = row["profile_evidence"]
        for role_id, canonical_id in mapping.items():
            if role_id == canonical_id:
                continue
            source = characters[role_id]
            target = characters[canonical_id]
            aliases = set(target.get("aliases") or [])
            aliases.update([source.get("name"), *(source.get("aliases") or [])])
            target["aliases"] = sorted(str(item).strip() for item in aliases if str(item or "").strip() and str(item).strip() != target.get("name"))
        document["characters"] = [item for item in document.get("characters") or [] if mapping.get(str(item.get("id") or ""), str(item.get("id") or "")) == str(item.get("id") or "")]
        name_by_id = {str(item.get("id") or ""): str(item.get("name") or "") for item in document["characters"]}
        for segment in document.get("segments") or []:
            current = str(segment.get("speaker_id") or "")
            final = mapping.get(current, current)
            segment["speaker_id"] = final
            segment["speaker_name"] = name_by_id.get(final, segment.get("speaker_name"))
            segment["speaker_candidates"] = list(dict.fromkeys(mapping.get(str(item), str(item)) for item in segment.get("speaker_candidates") or []))
        for scene in document.get("scenes") or []:
            scene["participants"] = list(dict.fromkeys(mapping.get(str(item), str(item)) for item in scene.get("participants") or []))

    def _analyze_context(
        self,
        source: str,
        requested_type: str,
        guidance: str,
        demographic_reference_text: str = "",
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        context_chunks = split_document(source, max(4000, min(12000, self.config.max_chunk_chars * 3)))
        characters: list[dict[str, Any]] = []
        scenes: list[dict[str, Any]] = []
        metrics = {"prompt_tokens": 0, "output_tokens": 0, "duration_seconds": 0.0, "requests": 0}
        for index, chunk in enumerate(context_chunks, start=1):
            prompt = f"""
你是长篇有声作品的全文角色与场景注册导演。当前处理注册阶段第 {index}/{len(context_chunks)} 块。

只完成角色和场景注册，不进行分句，不写详细人物小传，不生成声音参数。
1. 人物使用稳定 ID，旁白固定为 narrator。姓名、职称、外貌称谓和关系称谓写入同一角色 aliases。
2. 描述短语含副词或动作词时不得作为人物名称。新增人物必须提供 evidence 和 confidence。
3. 场景必须按视频分镜粒度登记。内容主题发生变化就建立新场景。小说中地点、室内外、人物所处方位、观察方向或叙事焦点变化时也建立新场景。人物集合、故事内时间或叙事视角变化同样可以成为边界。
4. 每个场景填写简短标题、当前主题、地点、空间方位、故事内时间、参与角色 ID、叙事视角、基调和边界依据。storyboard_note 使用 80 到 220 个中文字符写成可直接生成关键帧的场景小记，具体描述环境、人物位置与动作、前后景、镜头景别或观察方向、光线、色彩和关键物件。只写原文支持的画面，未知信息明确说明。
5. gender 结合本块原文和已关联文章证据中的称谓、亲属关系、身份、行为和上下文推断 female 或 male，并在 gender_evidence 记录证据。gender_basis 必须标记为 current_explicit、linked_explicit、current_inference、linked_inference 或 unknown。
6. 每个 character 的 age 都要结合本块原文和已关联文章证据中的明示年龄、亲属关系、身份、就学或职业阶段、时间线和行为语境推断整数，并在 age_evidence 记录证据。age_basis 使用与 gender_basis 相同的五类值。证据优先级为当前文章明示、关联文章明示、当前文章语境推断、关联文章语境推断。强证据不得被弱推断覆盖。范围年龄采用下限并保留完整范围。禁止无依据统一填写 35。narrator 可以填写 null。
7. profile 只写 40 到 120 个中文字符。voice_hint 只写 25 到 80 个中文字符。
8. 体裁要求：{requested_type}。用户导演补充：{guidance.strip() or '无'}。
9. 已注册人物：{json.dumps(characters, ensure_ascii=False, separators=(',', ':'))}

本块原文：
<<<SOURCE
{chunk}
SOURCE

已关联文章证据只用于识别本块人物和推断人口属性，不注册仅在关联文章出现的人物，不生成关联文章场景或分句：
<<<LINKED_ARTICLE_EVIDENCE
{demographic_reference_text.strip() or '无'}
LINKED_ARTICLE_EVIDENCE
""".strip()
            result, current_metrics = self._request_structured(
                prompt,
                CONTEXT_SCHEMA,
                system="你只输出严格符合 JSON Schema 的全文角色与场景注册结果。",
                schema_name="director_context",
                context_tokens=8192,
                keep_alive="30m",
            )
            raw_characters = result.get("characters")
            raw_scenes = result.get("scenes")
            if not isinstance(raw_characters, list) or not isinstance(raw_scenes, list):
                raise DirectorValidationError("全文角色与场景注册结果缺少 characters 或 scenes")
            self._merge_context_registry(raw_characters, raw_scenes, characters, scenes)
            metrics["prompt_tokens"] += current_metrics["prompt_tokens"]
            metrics["output_tokens"] += current_metrics["output_tokens"]
            metrics["duration_seconds"] += current_metrics["duration_seconds"]
            metrics["requests"] += 1
        return characters, scenes, metrics

    @classmethod
    def _merge_context_registry(
        cls,
        raw_characters: list[Any],
        raw_scenes: list[Any],
        characters: list[dict[str, Any]],
        scenes: list[dict[str, Any]],
    ) -> None:
        alias_index: dict[str, dict[str, Any]] = {}
        for character in characters:
            for value in [character["name"], *character.get("aliases", [])]:
                alias_index[str(value).strip().casefold()] = character
        local_to_global: dict[str, str] = {}
        for raw in raw_characters:
            if not isinstance(raw, dict):
                continue
            candidate = cls._normalize_character(raw)
            keys = [candidate["name"], *candidate.get("aliases", [])]
            existing = next((alias_index.get(str(value).strip().casefold()) for value in keys if str(value).strip()), None)
            if existing is None:
                candidate["id"] = "narrator" if candidate["kind"] == "narrator" else f"role_{len([item for item in characters if item['kind'] != 'narrator']) + 1:03d}"
                characters.append(candidate)
                existing = candidate
            else:
                existing_aliases = set(existing.get("aliases", []))
                existing_aliases.update(value for value in keys if value != existing["name"])
                existing["aliases"] = sorted(existing_aliases)
                if candidate.get("confidence", 0) > existing.get("confidence", 0):
                    for field in ("profile", "voice_hint", "confidence", "evidence"):
                        existing[field] = candidate.get(field, existing.get(field))
                if candidate.get("gender") in {"female", "male"} and cls._demographic_candidate_wins(existing, candidate, "gender"):
                    existing["gender"] = candidate["gender"]
                    existing["gender_evidence"] = candidate.get("gender_evidence", "")
                    existing["gender_basis"] = candidate.get("gender_basis", "unknown")
                if candidate.get("age") is not None and cls._demographic_candidate_wins(existing, candidate, "age"):
                    existing["age"] = candidate["age"]
                    existing["age_evidence"] = candidate.get("age_evidence", "")
                    existing["age_basis"] = candidate.get("age_basis", "unknown")
            for value in [existing["name"], *existing.get("aliases", [])]:
                alias_index[str(value).strip().casefold()] = existing
            local_to_global[candidate["id"]] = existing["id"]
            local_to_global[str(raw.get("id", ""))] = existing["id"]
        for raw in raw_scenes:
            if not isinstance(raw, dict):
                continue
            scene = cls._normalize_scene(raw, len(scenes) + 1)
            scene["id"] = f"scene_{len(scenes) + 1:03d}"
            scene["participants"] = [local_to_global.get(item, item) for item in scene["participants"]]
            scenes.append(scene)

    def _analyze_chunk(
        self,
        *,
        chunk: str,
        chunk_index: int,
        chunk_count: int,
        requested_type: str,
        existing_characters: list[dict[str, Any]],
        previous_context: str,
        guidance: str,
        single_anchor: bool = False,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        prompt = self._build_prompt(
            chunk=chunk,
            chunk_index=chunk_index,
            chunk_count=chunk_count,
            requested_type=requested_type,
            existing_characters=existing_characters,
            previous_context=previous_context,
            guidance=guidance,
        )
        last_error: Exception | None = None
        for attempt in range(2):
            current_prompt = prompt
            if attempt:
                current_prompt += (
                    "\n\n上一次输出未通过程序校验。请重新输出，并特别确保所有 source_text 按顺序拼接后"
                    "与本次原文逐字一致，包含叙述归属、引号和标点；所有 speaker_id 都必须出现在 characters。"
                    f"\n校验错误：{last_error}"
                )
            try:
                result, metrics = self._chat(current_prompt)
                if single_anchor:
                    result = self._enforce_single_anchor_result(result, requested_type)
                return self._validate_chunk(result, chunk, single_anchor=single_anchor), metrics
            except DirectorTimeout:
                raise
            except DirectorServiceError as exc:
                last_error = exc
                if attempt:
                    raise
            except (DirectorError, ValueError, TypeError, json.JSONDecodeError) as exc:
                last_error = exc
        raise DirectorValidationError(f"AI 连续两次未生成可验证的完整分轨：{last_error}")

    def _fallback_chunk(self, chunk: str, requested_type: str) -> dict[str, Any]:
        segments = []
        for index, source_text in enumerate(split_exact_sentences(chunk), start=1):
            spoken_text = source_text.strip().strip("“”‘’\"'")
            if not spoken_text:
                spoken_text = source_text.strip()
            segments.append({
                "order": index,
                "section": "安全分段",
                "speaker_id": "narrator",
                "speaker_name": "旁白",
                "speaker_kind": "narrator",
                "speaker_candidates": ["narrator"],
                "speaker_confidence": 0.5,
                "speaker_evidence": "确定性安全分段没有执行人物归属判断",
                "scene_id": "scene_001",
                "language": "ZH",
                "source_text": source_text,
                "text": spoken_text,
                "attitude": "中性叙述",
                "emotion": "calm",
                "intensity": 0.4,
                "pace": "自然",
                "pause_after_ms": 300,
            })
        fallback = {
                "content_type": requested_type if requested_type != "auto" else "story",
                "title": "安全分段",
                "characters": [
                    {
                        "id": "narrator",
                        "name": "旁白",
                        "kind": "narrator",
                        "aliases": ["旁白", "叙述者"],
                        "profile": "全篇叙事视角，负责环境、动作、心理活动与说话归属；不对应具体人物，声音需要在章节之间保持稳定。",
                        "voice_hint": "成熟中性的叙事声线，音高适中，共鸣稳定，吐字清楚，情绪克制并保留讲述感。",
                        "confidence": 1.0,
                        "evidence": "确定性安全分段",
                    }
                ],
                "scenes": [{"id": "scene_001", "title": "安全分镜", "topic": "原文连续叙述", "location": "未判断", "spatial_direction": "未判断", "time": "未判断", "participants": ["narrator"], "narrative_perspective": "旁白", "mood": "中性", "storyboard_note": "原文已进入确定性安全分段，当前缺少足够的 AI 画面分析结果。关键帧生成前需要重新执行全文分析并复核地点、人物位置、镜头方向与环境细节。", "boundary_reason": "安全分段起点", "evidence": "确定性安全分段"}],
                "segments": segments,
            }
        single_anchor = requested_type in SINGLE_ANCHOR_CONTENT_TYPES
        if single_anchor:
            fallback = self._enforce_single_anchor_result(fallback, requested_type)
        return self._validate_chunk(fallback, chunk, single_anchor=single_anchor)

    def _build_prompt(
        self,
        *,
        chunk: str,
        chunk_index: int,
        chunk_count: int,
        requested_type: str,
        existing_characters: list[dict[str, Any]],
        previous_context: str,
        guidance: str,
    ) -> str:
        if requested_type in SINGLE_ANCHOR_CONTENT_TYPES:
            schema_text = json.dumps(DIRECTOR_SCHEMA, ensure_ascii=False, separators=(",", ":"))
            label = CONTENT_TYPE_LABELS[requested_type]
            return f"""
你是专业有声内容导演和中文文本编辑。当前稿件已经判定为{label}，处理第 {chunk_index}/{chunk_count} 个连续文本块。

本稿件必须使用单主播分析管线：
1. characters 只能输出一个对象，固定为 id=anchor、name=主播、kind=anchor。稿件中出现的人名、称谓、被采访者和引用来源都是播报内容，不建立独立角色。
2. 主播不是稿件中出现的人物。gender 固定为 unspecified，age 固定为 null，证据类型固定为 unknown。禁止根据稿件人物推断主播年龄或性别。
3. 所有 segments 的 speaker_id 固定为 anchor，speaker_name 固定为主播，speaker_kind 固定为 anchor。引号、转述、采访引用和人物原话仍由同一个主播播报。
4. 识别自然段与适合朗读的句子边界。每条 source_text 必须从本次原文按顺序逐字复制，全部 source_text 拼接后必须与本次原文完全一致，允许的差异只有空白字符。
5. text 是 source_text 的可朗读清洗稿，只修正排版噪声，不改变事实、观点和原意。
6. 每条 segment 独立判断态度、八类基础情绪、情绪强度、句内节奏和句后停顿。新闻保持清楚、客观和克制；评论保留原文观点强度与论述节奏。
7. 每条 segment 标注 ZH、EN、JA、ES、AR 之一。混合语言按主要朗读语言拆句。
8. scenes 按主题、地点、时间、论述阶段或画面焦点变化划分，并填写完整分镜字段。participants 只填写 anchor，画面中被报道或评论的人物写进 storyboard_note，不建立声音角色。
9. 用户导演补充：{guidance.strip() or '无'}。全部补充都作用于唯一主播及全篇表达。
10. profile 与 voice_hint 只说明唯一主播职责和中性播报基线。具体主播声音、年龄感、性别感和表达特征由使用者在角色资产中人工设置。

上一文本块结尾只用于语义连续性，不要重复输出：{previous_context or '无'}

本次原文开始：
<<<SOURCE
{chunk}
SOURCE

JSON Schema：{schema_text}
只输出符合 Schema 的 JSON，不输出说明文字。
""".strip()
        type_instruction = {
            "auto": "智能判断 novel、news、commentary、story 中最合适的体裁。",
            "novel": "体裁固定为 novel。旁白负责环境、动作、心理和说话归属；人物台词独立分轨。",
            "story": "体裁固定为 story。旁白具有讲述感，人物台词保持可辨识的态度变化。",
        }[requested_type]
        roster = json.dumps(existing_characters, ensure_ascii=False, separators=(",", ":"))
        scene_registry = json.dumps(getattr(self, "_scene_registry", []), ensure_ascii=False, separators=(",", ":"))
        schema_text = json.dumps(DIRECTOR_SCHEMA, ensure_ascii=False, separators=(",", ":"))
        return f"""
你是专业有声内容导演和中文文本编辑。处理第 {chunk_index}/{chunk_count} 个连续文本块。

任务要求：
1. 清理适合朗读的文本，修正多余空白和明显排版噪声，不改变事实、人物关系和原意。
2. 智能识别自然段、段内句子、人物、旁白、主播、记者和采访对象，每个可独立配音的句子形成一条 segment。任何 segment 都必须包含可朗读文字，禁止把句号、逗号、引号、省略号或其他纯标点单独输出为 segment。
3. 拆句前先由你结合完整句、相邻句、人物表和说话动作，判断每组引号的语义功能属于人物对白、心理活动、句内引用或普通叙述，再决定 segment 边界和角色轨道。不要输出中间推理。旁白和说话归属文字也必须保留并单独成句。例如“李明说：”属于旁白，不能只保留引号内台词。名称、招牌文字、术语和标题等句内短引用属于所在叙述句的句法成分，不得仅因引号独立拆句。例如“店门挂着‘烤乌贼饼’的招牌”应保持为同一条旁白 segment。
4. 每条 source_text 必须从本次原文中按顺序逐字复制。全部 source_text 拼接后必须与本次原文完全一致，允许的差异只有空白字符。
5. text 是对应 source_text 的可朗读清洗稿。去除只用于排版的外层引号，不得遗漏可朗读信息。
6. 态度只能使用：{'、'.join(ATTITUDE_PRESETS)}。句内节奏只能使用：{'、'.join(PACE_PRESETS)}。另标注八类情绪、0 到 1 情绪强度和 0 到 3000 毫秒句后停顿。态度表示人物对听者或事件的姿态，情绪表示人物内在状态，句内节奏表示本句推进方式，三个字段分别判断。
7. 每条 segment 标注 ZH、EN、JA、ES、AR 之一。混合语言按主要朗读语言拆句。
8. 人物必须使用稳定 ID。优先复用已有角色及 aliases；旁白固定使用 narrator。描述短语含副词或动作词时不得作为人物名称。新增人物需要 evidence 和 confidence。证据不足时把最多三个候选放入 speaker_candidates，并降低 speaker_confidence。
9. {type_instruction}
10. 用户导演补充：{guidance.strip() or '无'}。先进行语义拆分：作品级要求应用于全部轨道；点名角色、角色类型、主角、配角、身份描述或上下文指代的要求只应用于目标角色。把角色专属声音要求合并进目标角色的 voice_hint，把角色专属表演要求应用于该角色的 segments，禁止复制给无关角色。
11. 每个角色的 profile 在本阶段只写 40 到 120 个中文字符，记录当前原文明确支持的身份、关系、行为和说话方式。详细人物小传由独立功能扩写，不能占用分句请求的输出预算。
12. 每个角色的 voice_hint 是声音导演建议，使用 25 到 100 个中文字符，说明年龄感、声线质感、音高、共鸣位置、气息、吐字方式和基础情绪。不要重复姓名，不要写“根据角色内容选择”等空泛占位词。
13. 每个 character 都必须根据当前原文和全文角色注册表推断 gender 与 age，并在对应 evidence 字段记录证据。gender_basis 与 age_basis 必须标记为 current_explicit、linked_explicit、current_inference、linked_inference 或 unknown。证据优先级为当前文章明示、关联文章明示、当前文章语境推断、关联文章语境推断。强证据不得被弱推断覆盖。范围年龄采用下限，禁止无依据统一填写 35。角色资产字段只用于人物识别，全文注册表中的关联文章证据可以参与本次 AI 人口属性分析。
14. 已有角色的人物小传或声音导演建议信息不足时，结合当前文本块补充；有明确原文依据的新信息优先于旧占位内容。
15. 先按视频分镜粒度识别本块 scenes。每当内容主题变化就建立新场景。小说中地点、室内外、人物方位、观察方向或叙事焦点发生变化时建立新场景。人物集合、故事内时间或叙事视角变化也可以形成边界。禁止用一个宽泛场景覆盖多个已经发生主题、地点或方位变化的连续段落。
16. 每个 scene 必须填写 title、topic、location、spatial_direction、time、participants、narrative_perspective、mood、boundary_reason 和 evidence。storyboard_note 使用 80 到 220 个中文字符写成关键帧画面小记，具体包含环境、人物位置与动作、前后景、镜头景别或观察方向、光线、色彩和关键物件。每条 segment 必须引用本块 scenes 中准确的 scene_id。
17. 每条 segment 使用 speaker_evidence 简述说话动作、上下文关系或指代依据。连续句出现异常说话人、情绪或节奏跳变时先复核上下文一致性。

已有角色表：{roster or '[]'}
全文场景注册表：{scene_registry or '[]'}。优先复用其中的 scene id；当前块出现有证据的新场景时可以新增。
上一文本块结尾，仅用于人物连续性，不要重复输出：{previous_context or '无'}

本次原文开始：
<<<SOURCE
{chunk}
SOURCE

JSON Schema：{schema_text}
只输出符合 Schema 的 JSON，不输出说明文字。
""".strip()

    def resolve_guidance(self, guidance: str, role_table: Any) -> dict[str, Any]:
        guidance = str(guidance or "").strip()
        roster = guidance_role_roster(role_table)
        role_ids = [item["role_id"] for item in roster]
        clauses = split_guidance_clauses(guidance)
        role_signature = guidance_role_signature(role_table)
        if not clauses:
            return {"guidance": guidance, "model": self.config.model, "role_signature": role_signature, "assignments": [], "resolved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        if len(roster) == 1 and roster[0]["kind"] == "anchor":
            anchor = roster[0]
            return {
                "guidance": guidance,
                "model": "deterministic-single-anchor",
                "role_signature": role_signature,
                "assignments": [
                    {
                        "clause_index": index,
                        "source_text": clause,
                        "scope": "roles",
                        "target_role_ids": [anchor["role_id"]],
                        "target_role_names": [anchor["name"]],
                        "instruction": clause,
                        "reason": "新闻或评论只有一个主播，全部导演补充作用于该主播",
                    }
                    for index, clause in enumerate(clauses, start=1)
                ],
                "resolved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
        prompt = f"""
你是有声作品导演补充的语义路由器。结合完整角色表，判断每个原子补充影响全部轨道，或只影响一个或多个具体角色。

规则：
1. “旁白”只指 kind=narrator 的轨道。“主播”“记者”“采访对象”按 kind 分配。
2. 人名、身份、小传描述、主角、女主、男主、配角、反派、关系称谓和上下文指代，都要结合角色表做语义匹配。
3. 连续片段可以继承前一片段的目标。例如“旁白缓慢而深沉，老年男性音色”两个片段都分配给旁白。
4. 作品氛围、整体节奏等没有角色目标的要求 scope=global，target_role_ids 包含全部角色 ID。
5. scope=roles 时必须给出准确 target_role_ids。不要把角色专属条件复制给无关角色。
6. clause_index 必须逐项覆盖 1 到 {len(clauses)}，每个编号恰好出现一次。instruction 保留原意并写成可直接用于该目标的简短导演指令。

角色表：
{json.dumps(roster, ensure_ascii=False, separators=(',', ':'))}

原子补充：
{json.dumps([{"clause_index": index + 1, "source_text": clause} for index, clause in enumerate(clauses)], ensure_ascii=False, separators=(',', ':'))}
""".strip()
        last_error: Exception | None = None
        for attempt in range(2):
            current_prompt = prompt
            if attempt:
                current_prompt += (
                    f"\n\n上一次分配未通过程序校验：{last_error}。"
                    "请重新输出完整 assignments，明确点名某个轨道的片段绝对不能使用 global。"
                )
            try:
                result, _ = self._request_structured(
                    current_prompt,
                    GUIDANCE_ROUTING_SCHEMA,
                    system="你只输出严格符合 JSON Schema 的导演补充语义分配。",
                    schema_name="guidance_routing",
                    context_tokens=4096,
                    keep_alive=0,
                )
                assignments = validate_guidance_assignments(result, clauses, roster)
                return {
                    "guidance": guidance,
                    "model": self.config.model,
                    "role_signature": role_signature,
                    "assignments": assignments,
                    "resolved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                }
            except (DirectorValidationError, DirectorServiceError, json.JSONDecodeError) as exc:
                last_error = exc
        raise DirectorValidationError(f"AI 连续两次未生成可验证的导演补充语义分配：{last_error}")

    @staticmethod
    def _compatible_text(payload: dict[str, Any]) -> str:
        output_text = payload.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            content = choices[0].get("message", {}).get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return "".join(str(item.get("text", "")) for item in content if isinstance(item, dict))
        output = payload.get("output")
        if isinstance(output, list):
            for item in output:
                for content in item.get("content", []) if isinstance(item, dict) else []:
                    if isinstance(content, dict) and isinstance(content.get("text"), str):
                        return content["text"]
        return ""

    def _request_structured(
        self,
        prompt: str,
        schema: dict[str, Any],
        *,
        system: str,
        schema_name: str,
        context_tokens: int,
        keep_alive: Any,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        started = time.perf_counter()
        if self.config.provider == "ollama":
            url = f"{self.base_url}/api/chat"
            headers: dict[str, str] = {}
            body = {
                "model": self.config.model,
                "stream": False,
                "think": False,
                "keep_alive": keep_alive,
                "format": schema,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                "options": {"temperature": 0, "seed": 42, "num_ctx": context_tokens},
            }
        elif self.config.text_api == "responses":
            url = self._compatible_route("/responses")
            headers = self._compatible_headers()
            body = {
                "model": self.config.model,
                "instructions": system,
                "input": prompt,
                "stream": False,
                "text": {"format": {"type": "json_schema", "name": schema_name, "strict": True, "schema": schema}},
            }
        else:
            url = self._compatible_route("/chat/completions")
            headers = self._compatible_headers()
            body = {
                "model": self.config.model,
                "stream": False,
                "temperature": 0,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                "response_format": {"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}},
            }
        try:
            request_kwargs = {"json": body, "timeout": self.config.timeout_seconds}
            if headers:
                request_kwargs["headers"] = headers
            response = requests.post(url, **request_kwargs)
            response.raise_for_status()
        except requests.Timeout as exc:
            raise DirectorTimeout(f"AI 在 {self.config.timeout_seconds} 秒内未完成当前请求") from exc
        except requests.RequestException as exc:
            raise DirectorServiceError(f"AI 调用失败：{exc}") from exc
        payload = response.json()
        content = payload.get("message", {}).get("content") if self.config.provider == "ollama" else self._compatible_text(payload)
        if not isinstance(content, str) or not content.strip():
            raise DirectorServiceError("AI 返回了空结果。")
        result = json.loads(content)
        usage = payload.get("usage") or {}
        metrics = {
            "prompt_tokens": int(payload.get("prompt_eval_count") or usage.get("input_tokens") or usage.get("prompt_tokens") or 0),
            "output_tokens": int(payload.get("eval_count") or usage.get("output_tokens") or usage.get("completion_tokens") or 0),
            "duration_seconds": round(time.perf_counter() - started, 3),
        }
        return result, metrics

    def _chat(self, prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
        return self._request_structured(
            prompt,
            DIRECTOR_SCHEMA,
            system="你只输出严格符合 JSON Schema 的有声导演结果，完整保留原文可朗读信息。",
            schema_name="audio_director",
            context_tokens=8192,
            keep_alive="30m",
        )

    def _validate_chunk(self, result: dict[str, Any], source: str, single_anchor: bool = False) -> dict[str, Any]:
        if not isinstance(result, dict):
            raise DirectorError("AI 结果不是 JSON 对象。")
        content_type = str(result.get("content_type", ""))
        if content_type not in ANALYZED_CONTENT_TYPES:
            raise DirectorError("AI 结果缺少有效体裁。")
        raw_characters = result.get("characters")
        raw_scenes = result.get("scenes", [])
        raw_segments = result.get("segments")
        if not isinstance(raw_characters, list) or not isinstance(raw_segments, list) or not raw_segments:
            raise DirectorError("AI 结果缺少角色或分句。")

        characters: list[dict[str, Any]] = []
        character_ids: set[str] = set()
        for raw in raw_characters:
            if not isinstance(raw, dict):
                raise DirectorError("角色项格式无效。")
            character = self._normalize_character(raw)
            if character["kind"] == "character" and character.get("age") is None:
                raise DirectorError(f"角色 {character['name']} 缺少基于当前文章的年龄推断。")
            if character["id"] in character_ids:
                continue
            character_ids.add(character["id"])
            characters.append(character)

        scenes = [
            self._normalize_scene(raw, index)
            for index, raw in enumerate(raw_scenes, start=1)
            if isinstance(raw, dict)
        ]
        if not scenes:
            scenes = [{"id": "scene_001", "title": "待分析场景", "topic": "待分析", "location": "未判断", "spatial_direction": "未判断", "time": "未判断", "participants": [], "narrative_perspective": "未判断", "mood": "中性", "storyboard_note": "当前结果缺少可用于视频关键帧的场景小记，需要重新执行全文分析并补充环境、人物位置、镜头方向、光线和关键物件。", "boundary_reason": "旧版结果未记录场景边界", "evidence": "旧版结果未提供场景数据"}]
        scene_ids = {scene["id"] for scene in scenes}

        segments: list[dict[str, Any]] = []
        for index, raw in enumerate(raw_segments, start=1):
            if not isinstance(raw, dict):
                raise DirectorError(f"第 {index} 条分句格式无效。")
            segment = self._normalize_segment(raw, index)
            if segment["scene_id"] not in scene_ids:
                segment["scene_id"] = scenes[0]["id"]
            if segment["speaker_kind"] == "character" and is_speech_attribution(segment["source_text"]):
                segment["speaker_id"] = "narrator"
                segment["speaker_name"] = "旁白"
                segment["speaker_kind"] = "narrator"
            segments.append(segment)

        restore_exact_source_text(segments, source)
        if not single_anchor:
            while True:
                split_segments = self._split_embedded_dialogue(segments, characters)
                if len(split_segments) == len(segments):
                    break
                segments = split_segments
            segments = self._assign_adjacent_quoted_speakers(segments, characters)
            segments = self._merge_inline_quoted_narration(segments)
        segments = self._merge_punctuation_only_segments(segments)
        character_ids = {character["id"] for character in characters}
        for segment in segments:
            if segment["speaker_id"] not in character_ids:
                inferred_name = segment["speaker_name"]
                inferred = self._normalize_character(
                    {
                        "id": segment["speaker_id"],
                        "name": inferred_name,
                        "kind": segment["speaker_kind"],
                        "profile": f"{inferred_name}是原文中已识别的独立说话人物。当前片段未充分说明年龄、身份、人物关系和经历，需结合后续全文补充。",
                        "voice_hint": "身份信息尚少，先采用中性清晰、自然交流的声音；补充年龄感、声线和性格后再重新生成。",
                    }
                )
                characters.append(inferred)
                character_ids.add(inferred["id"])

        reconstructed = "".join(segment["source_text"] for segment in segments)
        if coverage_key(reconstructed) != coverage_key(source):
            raise DirectorError("source_text 未完整覆盖本次原文，存在遗漏、改写或顺序变化。")

        validated = {
            "content_type": content_type,
            "title": str(result.get("title", "")).strip() or "未命名内容",
            "characters": characters,
            "scenes": scenes,
            "segments": segments,
        }
        return self._enforce_single_anchor_result(validated, content_type) if single_anchor else validated

    @staticmethod
    def _split_embedded_dialogue(
        segments: list[dict[str, Any]],
        characters: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Separate narration/attribution from quoted dialogue using exact source slices."""
        split_segments: list[dict[str, Any]] = []
        speakers = [character for character in characters if character["kind"] != "narrator"]
        for segment in segments:
            source_text = segment["source_text"]
            quote_bounds: tuple[int, int] | None = None
            for opening, closing in (("“", "”"), ('"', '"'), ("‘", "’"), ("「", "」"), ("『", "』")):
                start = source_text.find(opening)
                end = source_text.find(closing, start + 1) if start >= 0 else -1
                if start >= 0 and end > start:
                    quote_bounds = (start, end)
                    break
            if quote_bounds is None:
                split_segments.append(segment)
                continue

            start, end = quote_bounds
            prefix = source_text[:start]
            dialogue = source_text[start : end + 1]
            suffix = source_text[end + 1 :]
            if not coverage_key(prefix) and not coverage_key(suffix):
                split_segments.append(segment)
                continue

            if coverage_key(prefix):
                split_segments.append(
                    {
                        **segment,
                        "speaker_id": "narrator",
                        "speaker_name": "旁白",
                        "speaker_kind": "narrator",
                        "source_text": prefix,
                        "text": prefix.strip(),
                        "attitude": "叙述与说话归属",
                        "emotion": "calm",
                        "intensity": min(segment["intensity"], 0.5),
                    }
                )

            dialogue_speaker = segment
            if segment["speaker_kind"] == "narrator":
                matched = OllamaTextDirector._match_context_speaker(prefix, speakers)
                if matched is None:
                    inferred_name = OllamaTextDirector._infer_quoted_speaker(prefix)
                    if inferred_name:
                        matched = {
                            "id": f"inferred-{len(speakers) + 1}",
                            "name": inferred_name,
                            "kind": "character",
                            "profile": f"{inferred_name}是由对白归属识别出的说话人物。当前片段未充分说明年龄、身份、人物关系和经历，需结合全文补充。",
                            "voice_hint": "身份信息尚少，先采用中性清晰、自然交流的声音；补充年龄感、声线和性格后再重新生成。",
                        }
                        characters.append(matched)
                        speakers.append(matched)
                if matched is not None:
                    dialogue_speaker = {
                        **segment,
                        "speaker_id": matched["id"],
                        "speaker_name": matched["name"],
                        "speaker_kind": matched["kind"],
                    }
            split_segments.append(
                {
                    **dialogue_speaker,
                    "source_text": dialogue,
                    "text": dialogue[1:-1].strip(),
                }
            )

            if coverage_key(suffix):
                split_segments.append(
                    {
                        **segment,
                        "speaker_id": "narrator",
                        "speaker_name": "旁白",
                        "speaker_kind": "narrator",
                        "source_text": suffix,
                        "text": suffix.strip(),
                        "attitude": "叙述",
                        "emotion": "calm",
                        "intensity": min(segment["intensity"], 0.5),
                    }
                )
        return split_segments

    @staticmethod
    def _match_context_speaker(context: str, speakers: list[dict[str, Any]]) -> dict[str, Any] | None:
        compact = re.sub(r"\s+", "", str(context or ""))
        exact = next((character for character in speakers if str(character.get("name", "")) in compact), None)
        if exact is not None:
            return exact
        matches: list[tuple[int, dict[str, Any]]] = []
        for character in speakers:
            identity = f"{character.get('name', '')}{character.get('profile', '')}"
            for term in ROLE_REFERENCE_TERMS:
                if term in compact and term in identity:
                    matches.append((len(term), character))
        if matches:
            return max(matches, key=lambda item: item[0])[1]
        inferred_name = OllamaTextDirector._infer_quoted_speaker(compact)
        if inferred_name:
            return next(
                (
                    character
                    for character in speakers
                    if inferred_name == str(character.get("name", ""))
                    or inferred_name in str(character.get("profile", ""))
                ),
                None,
            )
        return None

    @staticmethod
    def _assign_adjacent_quoted_speakers(
        segments: list[dict[str, Any]],
        characters: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        speakers = [character for character in characters if character["kind"] != "narrator"]
        assigned: list[dict[str, Any]] = []
        for index, segment in enumerate(segments):
            source_text = str(segment.get("source_text", ""))
            previous_source = str(segments[index - 1].get("source_text", "")) if index else ""
            quote_only = bool(INLINE_QUOTED_TEXT_PATTERN.fullmatch(source_text))
            speech_context = bool(is_speech_attribution(previous_source) or SPEECH_CUE_PATTERN.search(previous_source.strip()))
            if segment.get("speaker_kind") == "narrator" and quote_only and speech_context:
                matched = OllamaTextDirector._match_context_speaker(previous_source, speakers)
                if matched is not None:
                    segment = {
                        **segment,
                        "speaker_id": matched["id"],
                        "speaker_name": matched["name"],
                        "speaker_kind": matched["kind"],
                    }
            assigned.append(segment)
        return assigned

    @staticmethod
    def _merge_inline_quoted_narration(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Rebuild a narrator sentence when a short quoted name was split as if it were dialogue."""
        merged = list(segments)
        index = 1
        while index + 1 < len(merged):
            left = merged[index - 1]
            quoted = merged[index]
            right = merged[index + 1]
            match = INLINE_QUOTED_TEXT_PATTERN.fullmatch(str(quoted.get("source_text", "")))
            content = next((group.strip() for group in match.groups() if group is not None), "") if match else ""
            left_source = str(left.get("source_text", ""))
            right_source = str(right.get("source_text", ""))
            inline_context = bool(
                match
                and content
                and not any(mark in content for mark in "。！？!?；;：:")
                and left.get("speaker_kind") == "narrator"
                and right.get("speaker_kind") == "narrator"
                and (
                    INLINE_QUOTE_RIGHT_PATTERN.match(right_source.lstrip())
                    or (
                        INLINE_QUOTE_LEFT_PATTERN.search(left_source.strip())
                        and not SPEECH_CUE_PATTERN.search(left_source.strip())
                    )
                )
            )
            if not inline_context:
                index += 1
                continue

            left_boundary = max((position for position, char in enumerate(left_source) if char in "。！？!?；;\n"), default=-1)
            before_end = left_boundary + 1
            while before_end < len(left_source) and left_source[before_end].isspace():
                before_end += 1
            before_source = left_source[:before_end]
            inline_left = left_source[before_end:]

            right_end = len(right_source)
            for position, char in enumerate(right_source):
                if char in "。！？!?；;\n":
                    right_end = position + 1
                    while right_end < len(right_source) and right_source[right_end].isspace():
                        right_end += 1
                    break
            inline_source = inline_left + str(quoted["source_text"]) + right_source[:right_end]
            after_source = right_source[right_end:]

            replacement: list[dict[str, Any]] = []
            if coverage_key(before_source):
                replacement.append({**left, "source_text": before_source, "text": before_source.strip()})
            else:
                inline_source = before_source + inline_source

            replacement.append(
                {
                    **left,
                    "speaker_id": "narrator",
                    "speaker_name": "旁白",
                    "speaker_kind": "narrator",
                    "source_text": inline_source,
                    "text": inline_source.strip(),
                    "pace": "medium",
                    "pause_after_ms": right.get("pause_after_ms", left.get("pause_after_ms", 300)),
                }
            )
            if coverage_key(after_source):
                replacement.append({**right, "source_text": after_source, "text": after_source.strip()})
            elif after_source:
                replacement[-1]["source_text"] += after_source

            merged[index - 1 : index + 2] = replacement
            index = max(1, index - 1)
        return merged

    @staticmethod
    def _merge_punctuation_only_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Attach punctuation-only AI output to adjacent readable segments without losing source coverage."""
        merged: list[dict[str, Any]] = []
        leading_source = ""
        leading_text = ""
        for segment in segments:
            source_text = str(segment.get("source_text", ""))
            synthesis_text = str(segment.get("text", ""))
            readable = any(character.isalnum() for character in source_text + synthesis_text)
            if readable:
                if leading_source or leading_text:
                    segment = {
                        **segment,
                        "source_text": leading_source + source_text,
                        "text": leading_text + synthesis_text,
                    }
                    leading_source = ""
                    leading_text = ""
                merged.append(segment)
                continue
            if merged:
                merged[-1] = {
                    **merged[-1],
                    "source_text": str(merged[-1]["source_text"]) + source_text,
                    "text": str(merged[-1]["text"]) + synthesis_text,
                    "pause_after_ms": segment.get("pause_after_ms", merged[-1].get("pause_after_ms", 300)),
                }
            else:
                leading_source += source_text
                leading_text += synthesis_text
        if leading_source or leading_text:
            raise DirectorValidationError("AI 分句结果只有标点，缺少可朗读文本。")
        return merged

    @staticmethod
    def _infer_quoted_speaker(prefix: str) -> str:
        compact = re.sub(r"\s+", "", prefix)
        patterns = (
            r"(?:传来|响起|听见|听到)([\u4e00-\u9fff]{1,6})的(?:喊声|声音|叫声|低语)",
            r"([\u4e00-\u9fff]{1,6})在[^，。！？；：]{0,16}(?:说|问|答|回应|喊|叫|道)[：:]$",
            r"(?:^|[。！？；])([\u4e00-\u9fff]{2,4}?)(?:握|抬|看|走|站|坐|转|伸|点|摇|皱|拿|放|推|拉)[^，。！？；：]{0,16}，(?:冷冷|轻声|低声|大声|焦急|平静|愤怒)?(?:地)?(?:说|问|答|回应|喊|叫|道)[：:]$",
            r"([\u4e00-\u9fff]{1,6}?)(?:冷冷|轻声|低声|大声|焦急|平静|愤怒|亲切|温和|严肃|缓缓)?(?:地)?(?:说|问|答|回应|喊|叫|道)[：:]$",
        )
        for pattern in patterns:
            match = re.search(pattern, compact)
            if match:
                return match.group(1)
        return ""

    @staticmethod
    def _normalize_character(raw: dict[str, Any]) -> dict[str, Any]:
        role_id = str(raw.get("id", "")).strip()
        name = str(raw.get("name", "")).strip()
        kind = str(raw.get("kind", "")).strip()
        if not role_id or not name or kind not in ROLE_KINDS:
            raise DirectorError("角色缺少有效 id、name 或 kind。")
        if kind == "narrator":
            role_id = "narrator"
            name = "旁白"
        normalized = {
            "id": role_id,
            "name": name,
            "kind": kind,
            "profile": str(raw.get("profile", "")).strip(),
            "voice_hint": str(raw.get("voice_hint", "")).strip(),
            "gender": str(raw.get("gender", "unspecified")).strip() if str(raw.get("gender", "unspecified")).strip() in {"female", "male", "unspecified"} else "unspecified",
            "gender_evidence": str(raw.get("gender_evidence", "")).strip(),
            "gender_basis": str(raw.get("gender_basis", "unknown")).strip() if str(raw.get("gender_basis", "unknown")).strip() in DEMOGRAPHIC_BASIS_PRIORITY else "unknown",
            "age": max(5, min(100, int(raw["age"]))) if isinstance(raw.get("age"), int) and not isinstance(raw.get("age"), bool) else None,
            "age_evidence": str(raw.get("age_evidence", "")).strip(),
            "age_basis": str(raw.get("age_basis", "unknown")).strip() if str(raw.get("age_basis", "unknown")).strip() in DEMOGRAPHIC_BASIS_PRIORITY else "unknown",
        }
        if any(key in raw for key in ("aliases", "confidence", "evidence")):
            normalized.update({
                "aliases": [str(item).strip() for item in raw.get("aliases", []) if str(item).strip() and str(item).strip() != name],
                "confidence": round(max(0.0, min(1.0, float(raw.get("confidence", 1.0)))), 2),
                "evidence": str(raw.get("evidence", "")).strip(),
            })
        return normalized

    @staticmethod
    def _demographic_candidate_wins(existing: dict[str, Any], candidate: dict[str, Any], field: str) -> bool:
        existing_basis = str(existing.get(f"{field}_basis") or "unknown")
        candidate_basis = str(candidate.get(f"{field}_basis") or "unknown")
        return DEMOGRAPHIC_BASIS_PRIORITY.get(candidate_basis, 0) >= DEMOGRAPHIC_BASIS_PRIORITY.get(existing_basis, 0)

    @staticmethod
    def _normalize_scene(raw: dict[str, Any], default_index: int) -> dict[str, Any]:
        location = str(raw.get("location", "未说明")).strip() or "未说明"
        evidence = str(raw.get("evidence", "")).strip()
        return {
            "id": str(raw.get("id", "")).strip() or f"scene_{default_index:03d}",
            "title": str(raw.get("title", "")).strip() or f"场景 {default_index:03d}",
            "topic": str(raw.get("topic", "")).strip() or evidence or "未说明",
            "location": location,
            "spatial_direction": str(raw.get("spatial_direction", "未说明")).strip() or "未说明",
            "time": str(raw.get("time", "未说明")).strip() or "未说明",
            "participants": [str(item).strip() for item in raw.get("participants", []) if str(item).strip()],
            "narrative_perspective": str(raw.get("narrative_perspective", "未说明")).strip() or "未说明",
            "mood": str(raw.get("mood", "中性")).strip() or "中性",
            "storyboard_note": str(raw.get("storyboard_note", "")).strip() or f"场景发生在{location}。{evidence or '原文画面细节待复核。'}",
            "boundary_reason": str(raw.get("boundary_reason", "")).strip() or "场景内容发生变化",
            "evidence": evidence,
        }

    @staticmethod
    def _finalize_scene_ranges(
        scenes: list[dict[str, Any]],
        segments: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        orders_by_scene: dict[str, list[int]] = {}
        for segment in segments:
            scene_id = str(segment.get("scene_id", "")).strip()
            order = int(segment.get("order", 0) or 0)
            if scene_id and order > 0:
                orders_by_scene.setdefault(scene_id, []).append(order)
        finalized: list[dict[str, Any]] = []
        for scene in scenes:
            orders = orders_by_scene.get(str(scene.get("id", "")), [])
            if not orders:
                continue
            finalized.append({
                **scene,
                "start_segment_order": min(orders),
                "end_segment_order": max(orders),
            })
        return finalized

    @staticmethod
    def _normalize_segment(raw: dict[str, Any], default_order: int) -> dict[str, Any]:
        speaker_id = str(raw.get("speaker_id", "")).strip()
        speaker_name = str(raw.get("speaker_name", "")).strip()
        speaker_kind = str(raw.get("speaker_kind", "")).strip()
        source_text = str(raw.get("source_text", ""))
        text = str(raw.get("text", "")).strip()
        attitude = str(raw.get("attitude", "")).strip()
        emotion = str(raw.get("emotion", "")).strip()
        pace = str(raw.get("pace", "")).strip()
        language = str(raw.get("language", "ZH")).strip().upper()
        if not speaker_id or not speaker_name or speaker_kind not in ROLE_KINDS:
            raise DirectorError(f"第 {default_order} 条分句的角色无效。")
        if speaker_kind == "narrator":
            speaker_id = "narrator"
            speaker_name = "旁白"
        if not source_text or not text or not attitude:
            raise DirectorError(f"第 {default_order} 条分句缺少原文、合成文本或态度。")
        if len(text) > 1200:
            raise DirectorError(f"第 {default_order} 条合成文本超过 1200 字符。")
        if emotion not in EMOTIONS or pace not in PACES | set(PACE_PRESETS) or language not in LANGUAGES:
            raise DirectorError(f"第 {default_order} 条分句的情绪、语速或语言无效。")
        intensity = max(0.0, min(1.0, float(raw.get("intensity", 0.65))))
        pause_after_ms = max(0, min(3000, int(raw.get("pause_after_ms", 400))))
        return {
            "order": int(raw.get("order") or default_order),
            "section": str(raw.get("section", "正文")).strip() or "正文",
            "speaker_id": speaker_id,
            "speaker_name": speaker_name,
            "speaker_kind": speaker_kind,
            "speaker_candidates": [str(item).strip() for item in raw.get("speaker_candidates", []) if str(item).strip()][:3] or [speaker_id],
            "speaker_confidence": round(max(0.0, min(1.0, float(raw.get("speaker_confidence", 1.0)))), 2),
            "speaker_evidence": str(raw.get("speaker_evidence", "")).strip(),
            "scene_id": str(raw.get("scene_id", "")).strip() or "scene_001",
            "language": language,
            "source_text": source_text,
            "text": text,
            "attitude": ATTITUDE_PRESETS.get(attitude, attitude),
            "attitude_preset": migrate_attitude_preset(attitude),
            "emotion": emotion,
            "intensity": round(intensity, 2),
            "pace": PACE_PRESETS[pace][0] if pace in PACE_PRESETS else pace,
            "pace_preset": migrate_pace_preset(pace),
            "pause_after_ms": pause_after_ms,
        }

    @staticmethod
    def _merge_chunk(
        result: dict[str, Any],
        global_characters: list[dict[str, Any]],
        global_segments: list[dict[str, Any]],
        global_scenes: list[dict[str, Any]],
    ) -> None:
        role_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        for item in global_characters:
            for value in [item["name"], *item.get("aliases", [])]:
                role_by_key[(item["kind"], "旁白" if item["kind"] == "narrator" else str(value).strip().casefold())] = item
        local_to_global: dict[str, str] = {}
        for character in result["characters"]:
            key = (
                character["kind"],
                "旁白" if character["kind"] == "narrator" else character["name"].strip().casefold(),
            )
            existing = role_by_key.get(key)
            if existing is None:
                created = deepcopy(character)
                if created["kind"] == "narrator":
                    created["id"] = "narrator"
                else:
                    created["id"] = f"role_{len([item for item in global_characters if item['kind'] != 'narrator']) + 1:03d}"
                global_characters.append(created)
                role_by_key[key] = created
                existing = created
            else:
                for field in ("profile", "voice_hint"):
                    current = str(existing.get(field, "")).strip()
                    candidate = str(character.get(field, "")).strip()
                    weak_tokens = ("由分句引用补全", "由说话归属文字识别", "根据角色内容选择", "原文未说明")
                    current_score = len(current) - sum(30 for token in weak_tokens if token in current)
                    candidate_score = len(candidate) - sum(30 for token in weak_tokens if token in candidate)
                    if candidate and candidate != existing.get("name") and candidate_score > current_score:
                        existing[field] = candidate
                if character.get("gender") in {"female", "male"} and OllamaTextDirector._demographic_candidate_wins(existing, character, "gender"):
                    existing["gender"] = character["gender"]
                    existing["gender_evidence"] = character.get("gender_evidence", "")
                    existing["gender_basis"] = character.get("gender_basis", "unknown")
                if character.get("age") is not None and OllamaTextDirector._demographic_candidate_wins(existing, character, "age"):
                    existing["age"] = character["age"]
                    existing["age_evidence"] = character.get("age_evidence", "")
                    existing["age_basis"] = character.get("age_basis", "unknown")
            local_to_global[character["id"]] = existing["id"]

        local_scene_to_global: dict[str, str] = {}
        scene_by_id = {scene["id"]: scene for scene in global_scenes}
        for scene in result.get("scenes", []):
            identity_fields = ("topic", "location", "spatial_direction")
            scene_identity = tuple(str(scene.get(field, "")).strip().casefold() for field in identity_fields)
            existing_scene = next(
                (
                    candidate
                    for candidate in global_scenes
                    if scene_identity == tuple(str(candidate.get(field, "")).strip().casefold() for field in identity_fields)
                ),
                None,
            )
            same_id_scene = scene_by_id.get(scene["id"])
            if existing_scene is None and same_id_scene is not None:
                same_id_identity = tuple(str(same_id_scene.get(field, "")).strip().casefold() for field in identity_fields)
                if same_id_identity == scene_identity:
                    existing_scene = same_id_scene
            if existing_scene is None:
                created_scene = deepcopy(scene)
                created_scene["id"] = f"scene_{len(global_scenes) + 1:03d}"
                created_scene["participants"] = [local_to_global.get(item, item) for item in scene.get("participants", [])]
                global_scenes.append(created_scene)
                scene_by_id[created_scene["id"]] = created_scene
                existing_scene = created_scene
            local_scene_to_global[scene["id"]] = existing_scene["id"]

        for segment in result["segments"]:
            merged = deepcopy(segment)
            merged["scene_id"] = local_scene_to_global.get(merged.get("scene_id", ""), global_scenes[-1]["id"] if global_scenes else "scene_001")
            merged["speaker_candidates"] = [local_to_global.get(item, item) for item in merged.get("speaker_candidates", [])]
            role_key = (
                merged["speaker_kind"],
                "旁白" if merged["speaker_kind"] == "narrator" else merged["speaker_name"].strip().casefold(),
            )
            role = role_by_key.get(role_key)
            if role is None:
                role_name = merged["speaker_name"]
                role = {
                    "id": "narrator" if merged["speaker_kind"] == "narrator" else f"role_{len(global_characters) + 1:03d}",
                    "name": role_name,
                    "kind": merged["speaker_kind"],
                    "profile": f"{role_name}是原文中已识别的独立说话人物。当前片段未充分说明年龄、身份、人物关系和经历，需结合后续全文补充。",
                    "voice_hint": "身份信息尚少，先采用中性清晰、自然交流的声音；补充年龄感、声线和性格后再重新生成。",
                }
                global_characters.append(role)
                role_by_key[role_key] = role
            merged["speaker_id"] = role["id"]
            global_segments.append(merged)


def _preferred_voice_ids(character: dict[str, Any], voice_ids: list[str]) -> list[str]:
    description = " ".join(
        str(character.get(key, "")) for key in ("name", "kind", "profile", "voice_hint")
    ).casefold()
    if character.get("kind") in {"narrator", "anchor"}:
        preferred = ["voice_05.wav", "voice_04.wav", "voice_03.wav"]
    elif any(keyword in description for keyword in ("孩子", "儿童", "少年", "少女", "活泼", "明亮", "轻快")):
        preferred = ["voice_09.wav", "voice_03.wav", "voice_06.wav"]
    elif any(keyword in description for keyword in ("低沉", "冷漠", "悲伤", "低落", "沧桑", "严肃")):
        preferred = ["voice_11.wav", "voice_05.wav", "voice_04.wav"]
    elif any(keyword in description for keyword in ("温柔", "诗", "抒情", "亲和", "平静")):
        preferred = ["voice_06.wav", "voice_04.wav", "voice_05.wav"]
    elif character.get("kind") in {"reporter", "interviewee"}:
        preferred = ["voice_04.wav", "voice_03.wav", "voice_06.wav"]
    else:
        preferred = ["voice_04.wav", "voice_06.wav", "voice_09.wav", "voice_11.wav", "voice_03.wav"]
    return [voice_id for voice_id in preferred if voice_id in voice_ids] or voice_ids


def _closest_preset(value: Any, presets: dict[str, Any], default: str) -> str:
    text = str(value or "").strip()
    if text in presets:
        return text
    for label, prompt in presets.items():
        prompt_text = prompt[1] if isinstance(prompt, tuple) else prompt
        if text == str(prompt_text) or label in text:
            return label
    return default


def migrate_voice_style(value: Any) -> str:
    text = str(value or "").strip()
    if text in VOICE_STYLE_PRESETS:
        return text
    # VoiceDesign 原生支持自然语言。旧音色条件作为高级提示完整保留。
    return text or "中性清晰"


def migrate_rhythm_preset(value: Any) -> str:
    text = str(value or "").strip()
    for keyword, label in (
        ("轻快", "轻快活泼"), ("灵动", "轻快活泼"), ("沉稳", "沉稳舒缓"),
        ("舒缓", "沉稳舒缓"), ("紧凑", "紧凑清晰"), ("快速", "紧凑清晰"),
        ("克制", "克制停连"), ("低声", "低声内敛"), ("威严", "威严有力"),
        ("有力", "威严有力"),
    ):
        if keyword in text:
            return label
    return _closest_preset(text, RHYTHM_PRESETS, "自然叙述")


def migrate_pace_preset(value: Any) -> str:
    legacy = {"slow": "舒缓", "medium": "自然", "fast": "紧凑"}
    text = str(value or "").strip()
    if text in legacy:
        return legacy[text]
    for keyword, label in (
        ("轻快", "轻快"), ("舒缓", "舒缓"), ("缓慢", "舒缓"), ("紧凑", "紧凑"),
        ("快速", "紧凑"), ("克制", "克制"), ("低声", "低声"), ("强调", "强调"),
    ):
        if keyword in text:
            return label
    return _closest_preset(text, PACE_PRESETS, "自然")


def migrate_attitude_preset(value: Any) -> str:
    text = str(value or "").strip()
    for keyword, label in (
        ("温和", "温和交流"), ("亲切", "温和交流"), ("紧张", "紧张警觉"),
        ("警觉", "紧张警觉"), ("克制", "克制低沉"), ("低沉", "克制低沉"),
        ("悲伤", "悲伤压抑"), ("压抑", "悲伤压抑"), ("喜悦", "喜悦明快"),
        ("明快", "喜悦明快"), ("愤怒", "愤怒强烈"), ("恐惧", "恐惧迟疑"),
        ("迟疑", "恐惧迟疑"), ("威严", "威严命令"), ("命令", "威严命令"),
        ("沉稳", "沉稳叙述"), ("平静", "中性叙述"),
    ):
        if keyword in text:
            return label
    return _closest_preset(text, ATTITUDE_PRESETS, "中性叙述")


def migrate_emotion_label(value: Any) -> str:
    text = str(value or "").strip()
    if text in EMOTION_VALUES:
        return text
    return EMOTION_LABELS.get(text, "平静")


def migrate_role_rows(role_table: Any) -> list[list[Any]]:
    rows = _table_rows(role_table)
    migrated = []
    for row in rows:
        copied = list(row)
        if len(copied) >= len(ROLE_HEADERS):
            copied[4] = migrate_voice_style(copied[4])
            copied[6] = migrate_rhythm_preset(copied[6])
        migrated.append(copied)
    return migrated


def migrate_segment_rows(segment_table: Any) -> list[list[Any]]:
    rows = _table_rows(segment_table)
    migrated = []
    for row in rows:
        copied = list(row)
        if len(copied) >= 12:
            if len(copied) < 13:
                copied.append("auto")
            if len(copied) < 14:
                copied.append("")
            if len(copied) < 15:
                copied.append("")
            if len(copied) < 16:
                copied.append(1)
            if len(copied) < 17:
                copied.append("none")
            if len(copied) < 18:
                copied.append("standard")
            copied[7] = migrate_attitude_preset(copied[7])
            copied[8] = migrate_emotion_label(copied[8])
            copied[10] = migrate_pace_preset(copied[10])
            copied[12] = str(copied[12] or "auto").strip() if str(copied[12] or "auto").strip() in EMOTION_DIRECTION_PRESETS else "auto"
            copied[13] = str(copied[13] or "").strip()
            copied[14] = str(copied[14] or "").strip()
            copied[15] = max(1, int(float(copied[15] or 1)))
            copied[16] = str(copied[16] or "none") if str(copied[16] or "none") in {"none", "medium", "strong"} else "none"
            copied[17] = "advanced" if copied[17] == "advanced" else "standard"
        migrated.append(copied)
    return migrated


def document_to_tables(document: dict[str, Any], demo_voice_ids: Iterable[str]) -> tuple[list[list[Any]], list[list[Any]]]:
    voice_ids = list(demo_voice_ids)
    if not voice_ids:
        raise DirectorError("没有可用于角色分配的演示音色。")
    roles: list[list[Any]] = []
    used_voices: set[str] = set()
    for character in document.get("characters", []):
        candidates = _preferred_voice_ids(character, voice_ids)
        preferred = next((voice_id for voice_id in candidates if voice_id not in used_voices), candidates[0])
        used_voices.add(preferred)
        description = " ".join(
            str(character.get(key, "")).strip() for key in ("profile", "voice_hint") if str(character.get(key, "")).strip()
        )
        role_rhythm = "沉稳舒缓，重音清晰，短语间自然停连" if character.get("kind") == "narrator" else "自然交流，按语义停连"
        if any(keyword in description for keyword in ("孩子", "儿童", "少年", "少女", "活泼", "轻快")):
            role_rhythm = "轻快灵动，声母清楚，短句间自然换气"
        elif any(keyword in description for keyword in ("老人", "年长", "低沉", "沧桑", "沉稳")):
            role_rhythm = "沉稳从容，韵母自然舒展，停连清晰"
        roles.append(
            [
                character["id"],
                character["name"],
                character["kind"],
                character.get("profile") or character.get("voice_hint", ""),
                migrate_voice_style(character.get("voice_hint", "") or character.get("profile", "")),
                preferred,
                migrate_rhythm_preset(role_rhythm),
                "否",
            ]
        )

    segments = [
        [
            segment["order"],
            segment["section"],
            segment["speaker_id"],
            segment["speaker_name"],
            segment["language"],
            segment["source_text"],
            segment["text"],
            segment.get("attitude_preset") or migrate_attitude_preset(segment["attitude"]),
            migrate_emotion_label(segment["emotion"]),
            segment["intensity"],
            segment.get("pace_preset") or migrate_pace_preset(segment["pace"]),
            segment["pause_after_ms"],
            "auto",
            "",
            "",
            1,
            "none",
            "standard",
        ]
        for segment in document.get("segments", [])
    ]
    return roles, segments


VOICE_DESIGN_TEXT = {
    "ZH": "这是我的声音。我会用清晰自然的方式，陪你走进这个故事。",
    "EN": "This is my voice. I will speak clearly and naturally throughout this story.",
    "JA": "これは私の声です。物語を自然で明瞭に語ります。",
    "ES": "Esta es mi voz. Hablaré con claridad y naturalidad durante esta historia.",
    "AR": "هذا هو صوتي. سأتحدث بوضوح وطبيعية طوال هذه القصة.",
}
QWEN_LANGUAGE_NAMES = {"ZH": "Chinese", "EN": "English", "JA": "Japanese", "ES": "Spanish", "AR": "Auto"}

VOICE_GENDER_TERMS = {
    "female": ("女性", "女声", "女人", "妇人", "妻子", "母亲", "奶奶", "姐姐", "妹妹", "女儿", "少女", "女孩"),
    "male": ("男性", "男声", "男人", "丈夫", "父亲", "爷爷", "哥哥", "弟弟", "儿子", "少年", "男孩"),
}


def age_voice_constraint(age: int) -> str:
    safe_age = max(5, min(100, int(age)))
    if safe_age < 13:
        return "年龄听感强约束：尚未变声的儿童声线，基频明显高于成年人，发声轻巧自然，保留儿童口腔共鸣、清亮度和稚嫩感；成年男性低音、胸腔厚重共鸣或成熟声带质感均不合格。"
    if safe_age < 20:
        return "年龄听感强约束：青少年声线，保持较轻的声带质感和自然明亮度，禁止明显中老年化粗粝声线。"
    if safe_age < 40:
        return "年龄听感强约束：青年到壮年声线，声带闭合自然，共鸣清晰，避免儿童感或明显衰老感。"
    if safe_age < 50:
        return "年龄听感强约束：成熟中年声线，声带质感稳实，共鸣位置适中，减少轻薄和少年感。"
    if safe_age < 70:
        return "年龄听感强约束：成熟偏老年声线，声带厚度明显，共鸣位置靠下，高频亮度受控，允许轻微自然粗粝和松弛感，禁止明亮、轻薄、紧致的青年声线。"
    return "年龄听感强约束：老年声线，声带质感厚而略松，共鸣靠下，高频亮度克制，带自然气息感和轻微粗粝感，禁止青年化清亮紧致声线。"


def gender_voice_identity_constraint(expected_gender: str, age: int) -> str:
    if age < 13 and expected_gender == "male":
        return (
            f"首要声音身份：必须由约 {age} 岁、尚未变声的男童自然发声。"
            "保持清楚可辨的男孩身份、儿童声带质感、轻巧口腔共鸣和自然稚嫩感。"
            "成年男性低音、成年男性胸腔共鸣、成熟声带质感、女童声线或成人模仿儿童的假声均不合格。"
        )
    if age < 13 and expected_gender == "female":
        return (
            f"首要声音身份：必须由约 {age} 岁女童自然发声。"
            "保持清楚可辨的女孩身份、儿童声带质感、轻巧口腔共鸣和自然稚嫩感。"
            "成年女性声线、成年男性声线、成熟胸腔共鸣、男童声线或成人模仿儿童的假声均不合格。"
        )
    if age < 20 and expected_gender == "male":
        return (
            f"首要声音身份：必须由约 {age} 岁少年自然发声。"
            "保持清楚可辨的少年男性身份、较轻声带质感和自然明亮度。"
            "成年男性厚重低音、女性声线或中老年粗粝声线均不合格。"
        )
    if age < 20 and expected_gender == "female":
        return (
            f"首要声音身份：必须由约 {age} 岁少女自然发声。"
            "保持清楚可辨的少女身份、较轻声带质感和自然明亮度。"
            "成年女性厚重声线、男性声线或中老年粗粝声线均不合格。"
        )
    if expected_gender == "female":
        return (
            f"首要声音身份：必须由约 {age} 岁女性自然发声。"
            "保持明确女性声线、女性声带质感和女性共鸣。"
            "男性声线、中性偏男性声线、男性假声或厚重男性胸腔共鸣均不合格。"
        )
    if expected_gender == "male":
        return (
            f"首要声音身份：必须由约 {age} 岁男性自然发声。"
            "保持明确男性声线、男性声带质感和男性共鸣。"
            "女性声线、中性偏女性声线、女性假声或轻薄女性头腔共鸣均不合格。"
        )
    return ""


def child_expression_direction(voice_hint: str, profile: str) -> str:
    source = f"{voice_hint} {profile}"
    if any(term in source for term in ("活泼", "开朗", "轻快", "兴奋")):
        return "情绪活泼自然"
    if any(term in source for term in ("悲伤", "低落", "压抑", "阴沉", "沉默", "低沉")):
        return "情绪安静克制，带轻微低落感"
    if any(term in source for term in ("紧张", "不安", "恐惧")):
        return "情绪略带紧张，表达保持克制"
    return "情绪自然克制"


def compact_child_voice_instruction(
    name: str,
    expected_gender: str,
    age: int,
    pitch_min_hz: float,
    pitch_max_hz: float,
    pitch_target_hz: float,
    voice_hint: str,
    profile: str,
) -> str:
    identity = "小学生男孩" if expected_gender == "male" else "小学生女孩"
    child_label = "男童" if expected_gender == "male" else "女童"
    pitch = (
        f"声音基频中位数自然保持在 {pitch_min_hz:.0f} 至 {pitch_max_hz:.0f} Hz，目标约 {pitch_target_hz:.0f} Hz。"
        if pitch_min_hz > 0 and pitch_max_hz > pitch_min_hz and pitch_min_hz <= pitch_target_hz <= pitch_max_hz
        else ""
    )
    return (
        f"一个 {age} 岁的{identity}，使用尚未变声的自然{child_label}童声说话。"
        f"听者必须能够直接辨认出这是{child_label}，性别身份比音高更重要。"
        "声音稚嫩、轻巧，具有明确的儿童口腔共鸣和小学生的日常说话感。"
        f"为角色{name}建立可长期复用的声音。{child_expression_direction(voice_hint, profile)}，"
        "吐字自然清楚，语速中等。"
        f"{pitch}"
        "干声，无背景音乐，无环境噪声。"
    )


def child_audition_text(language: str, age: int, expected_gender: str) -> str:
    identity = "男孩" if expected_gender == "male" else "女孩"
    if language == "JA":
        pronoun = "僕" if expected_gender == "male" else "わたし"
        identity_ja = "男の子" if expected_gender == "male" else "女の子"
        return f"{pronoun}は{age}歳の{identity_ja}です。学校から帰ってきたところです。何か用ですか。"
    if language == "EN":
        return f"I am a {age}-year-old {'boy' if expected_gender == 'male' else 'girl'}. I just came home from school. Did you need me?"
    if language == "ES":
        identity_es = "niño" if expected_gender == "male" else "niña"
        return f"Soy un {identity_es} de {age} años. Acabo de volver de la escuela. ¿Me buscabas?"
    return f"我是一个{age}岁的{identity}，刚从学校回来。你找我有什么事吗？"


def infer_voice_gender(voice_hint: str, profile: str = "", name: str = "") -> str:
    for source in (voice_hint, profile, name):
        female = any(term in source for term in VOICE_GENDER_TERMS["female"])
        male = any(term in source for term in VOICE_GENDER_TERMS["male"])
        if female != male:
            return "female" if female else "male"
    return "unspecified"


def build_voice_design_jobs(
    document: dict[str, Any],
    role_table: Any,
    project_context: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    rows = _table_rows(role_table)
    characters = {str(item.get("id")): item for item in document.get("characters", [])}
    role_languages: dict[str, str] = {}
    for segment in document.get("segments", []):
        role_languages.setdefault(str(segment.get("speaker_id")), str(segment.get("language", "ZH")).upper())
    jobs: list[dict[str, Any]] = []
    context = project_context or {}
    character_assets = context.get("character_assets") if isinstance(context.get("character_assets"), dict) else {}
    content_type = str(context.get("content_type") or document.get("content_type") or "novel")
    content_label = {"novel": "小说", "news": "新闻", "commentary": "一般评论", "story": "故事体"}.get(content_type, "小说")
    guidance = str(context.get("guidance") or "").strip().rstrip("。！？!?；;")
    guidance_routing = context.get("guidance_routing") or document.get("guidance_routing") or {}
    if guidance:
        if str(guidance_routing.get("guidance") or "").strip().rstrip("。！？!?；;") != guidance:
            raise DirectorError("导演补充尚未经过当前版本的 AI 语义分配。")
        if str(guidance_routing.get("role_signature") or "") != guidance_role_signature(rows):
            raise DirectorError("角色表已变化，需要重新执行导演补充 AI 语义分配。")
    guidance_assignments = guidance_routing.get("assignments") if isinstance(guidance_routing, dict) else []
    guidance_assignments = guidance_assignments if isinstance(guidance_assignments, list) else []
    for row_number, row in enumerate(rows, start=1):
        if len(row) < len(ROLE_HEADERS):
            raise DirectorError(f"角色表第 {row_number} 行字段不足。")
        role_id = str(row[0]).strip()
        name = str(row[1]).strip()
        kind = str(row[2]).strip()
        profile = str(row[3]).strip().rstrip("。！？!?；;")
        voice_condition = str(row[4]).strip()
        rhythm_preset = str(row[6]).strip()
        if not role_id or not name or kind not in ROLE_KINDS:
            raise DirectorError(f"角色表第 {row_number} 行角色信息无效。")
        character = characters.get(role_id, {})
        if voice_condition in VOICE_STYLE_PRESETS:
            voice_hint = VOICE_STYLE_PRESETS[voice_condition]
        elif voice_condition:
            voice_hint = voice_condition
        else:
            voice_hint = str(character.get("voice_hint", "")).strip()
        voice_hint = voice_hint.rstrip("。！？!?；;")
        if rhythm_preset not in RHYTHM_PRESETS:
            raise DirectorError(f"角色表第 {row_number} 行包含未知角色节奏预设：{rhythm_preset}")
        rhythm_prompt = RHYTHM_PRESETS[rhythm_preset].rstrip("。！？!?；;")
        language = role_languages.get(role_id, "ZH")
        kind_text = {
            "narrator": "旁白",
            "anchor": "新闻主播",
            "reporter": "记者",
            "interviewee": "采访对象",
            "character": "人物",
        }[kind]
        role_title = name if name == kind_text else f"{kind_text}{name}"
        role_guidance_assignments = [
            item
            for item in guidance_assignments
            if isinstance(item, dict) and role_id in item.get("target_role_ids", []) and str(item.get("instruction") or "").strip()
        ]
        effective_guidance = "；".join(
            str(item.get("instruction") or "").strip().rstrip("。！？!?；;")
            for item in role_guidance_assignments
        )
        asset = character_assets.get(role_id) if isinstance(character_assets.get(role_id), dict) else {}
        explicit_gender = str(asset.get("gender") or "")
        expected_gender = explicit_gender if explicit_gender in {"female", "male", "unspecified"} else infer_voice_gender(f"{voice_hint} {effective_guidance}", profile, name)
        age = max(5, min(100, int(asset.get("age") or 35)))
        pitch_min_hz = float(asset.get("pitch_min_hz") or 0)
        pitch_max_hz = float(asset.get("pitch_max_hz") or 0)
        pitch_target_hz = float(asset.get("pitch_target_hz") or 0)
        voice_traits = normalize_voice_traits(asset.get("voice_traits"))
        voice_generation = normalize_voice_generation(asset.get("voice_generation"))
        audition_text = str(asset.get("audition_text") or VOICE_DESIGN_TEXT.get(language, DEFAULT_AUDITION_TEXT)).strip()[:500]
        if age < 13 and expected_gender in {"female", "male"} and audition_text in {
            DEFAULT_AUDITION_TEXT,
            VOICE_DESIGN_TEXT.get(language, DEFAULT_AUDITION_TEXT),
        }:
            audition_text = child_audition_text(language, age, expected_gender)
        pitch_constraint = (
            f"角色年龄设定：约 {age} 岁。建议基频区间：{pitch_min_hz:.0f} 至 {pitch_max_hz:.0f} Hz；"
            f"目标基频中位数约 {pitch_target_hz:.0f} Hz；系统只接受落盘复测进入目标容差的原始自然声音。"
            if pitch_min_hz > 0 and pitch_max_hz > pitch_min_hz and pitch_min_hz <= pitch_target_hz <= pitch_max_hz
            else f"角色年龄设定：约 {age} 岁。"
        )
        age_constraint = age_voice_constraint(age)
        gender_constraint = gender_voice_identity_constraint(expected_gender, age)
        child_tone_constraint = (
            "儿童角色描述中的低沉、沉默或压抑只表示情绪与表达方式，不得降低成成年人的基频、胸腔共鸣或成熟声带质感。"
            if age < 13 else ""
        )
        if age < 13 and expected_gender == "male":
            gender_confirmation = "最终确认：输出必须保持自然、明确、可听辨的未变声男童声音。"
        elif age < 13 and expected_gender == "female":
            gender_confirmation = "最终确认：输出必须保持自然、明确、可听辨的女童声音。"
        else:
            gender_confirmation = {
                "female": "最终确认：输出必须保持自然、明确、可听辨的女性声音。",
                "male": "最终确认：输出必须保持自然、明确、可听辨的男性声音。",
                "unspecified": "",
            }[expected_gender]
        if age < 13 and expected_gender in {"female", "male"}:
            instruct = compact_child_voice_instruction(
                name, expected_gender, age, pitch_min_hz, pitch_max_hz, pitch_target_hz, voice_hint, profile
            )
        else:
            instruct = (
                f"{gender_constraint}"
                f"为{role_title}设计可长期复用的独特声音。作品体裁：{content_label}。"
                f"本角色有效导演上下文：{effective_guidance or '遵循作品体裁并保持角色跨章节一致'}。"
                f"人物小传：{profile or '原文身份信息不足，使用自然可信的角色声音'}。"
                f"声音导演：{voice_hint or '采用与人物身份和作品体裁相符的自然声线'}。"
                f"{pitch_constraint}"
                f"{age_constraint}"
                f"{child_tone_constraint}"
                f"{voice_traits_instruction(voice_traits)}"
                f"表达节奏：{rhythm_prompt or '自然表达，按语义停连'}。"
                "吐字清晰，干声，无背景音乐，无环境噪声。"
                f"{gender_confirmation}"
            )
        jobs.append(
            {
                "role_id": role_id,
                "name": name,
                "language": QWEN_LANGUAGE_NAMES.get(language, "Auto"),
                "text": audition_text or VOICE_DESIGN_TEXT.get(language, VOICE_DESIGN_TEXT["ZH"]),
                "instruct": instruct,
                "expected_gender": expected_gender,
                "character_age": age,
                "pitch_min_hz": pitch_min_hz or None,
                "pitch_max_hz": pitch_max_hz or None,
                "pitch_target_hz": pitch_target_hz or None,
                "pitch_calibration_version": 6,
                "effective_guidance_sources": [str(item.get("source_text") or "").strip() for item in role_guidance_assignments if str(item.get("source_text") or "").strip()],
                "effective_guidance_instructions": [str(item.get("instruction") or "").strip() for item in role_guidance_assignments if str(item.get("instruction") or "").strip()],
                "filename": f"ai-{_safe_name(role_id, 'role')}-{_safe_name(name, 'voice')}.wav",
                "voice_traits": voice_traits,
                "voice_generation": voice_generation,
                "seed": voice_generation["seed"],
            }
        )
    return jobs


def apply_generated_voices(role_table: Any, generated: Iterable[dict[str, str]]) -> list[list[Any]]:
    rows = _table_rows(role_table)
    paths_by_role = {
        str(item["role_id"]): str(item.get("voice_id") or Path(str(item["path"])).name)
        for item in generated
    }
    updated: list[list[Any]] = []
    for row in rows:
        copied = list(row)
        if copied and str(copied[0]) in paths_by_role:
            copied[5] = paths_by_role[str(copied[0])]
            copied[7] = "否"
        updated.append(copied)
    return updated


def _table_rows(value: Any) -> list[list[Any]]:
    if value is None:
        return []
    if hasattr(value, "values") and hasattr(value.values, "tolist"):
        return value.values.tolist()
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, list):
        return value
    raise DirectorError("编辑表格格式无效。")


def tables_to_script(role_table: Any, segment_table: Any) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    role_rows = _table_rows(role_table)
    segment_rows = []
    for raw_row in _table_rows(segment_table):
        copied = list(raw_row)
        if len(copied) >= 12:
            if len(copied) < 13:
                copied.append("auto")
            if len(copied) < 14:
                copied.append("")
            if len(copied) < 15:
                copied.append("")
            if len(copied) < 16:
                copied.append(1)
            if len(copied) < 17:
                copied.append("none")
            if len(copied) < 18:
                copied.append("standard")
        segment_rows.append(copied)
    roles: dict[str, dict[str, Any]] = {}
    for row_number, row in enumerate(role_rows, start=1):
        if len(row) < len(ROLE_HEADERS):
            raise DirectorError(f"角色表第 {row_number} 行字段不足。")
        role_id = str(row[0]).strip()
        name = str(row[1]).strip()
        kind = str(row[2]).strip()
        voice_id = str(row[5]).strip()
        voice_style = str(row[4]).strip()
        rhythm_preset = str(row[6]).strip()
        if not role_id or not name or kind not in ROLE_KINDS or not voice_id:
            raise DirectorError(f"角色表第 {row_number} 行包含无效角色或音色。")
        if not voice_style:
            raise DirectorError(f"角色表第 {row_number} 行必须选择音色预设或填写高级提示。")
        if rhythm_preset not in RHYTHM_PRESETS:
            raise DirectorError(f"角色表第 {row_number} 行包含未知角色节奏预设：{rhythm_preset}")
        if role_id in roles:
            raise DirectorError(f"角色表存在重复轨道ID：{role_id}")
        roles[role_id] = {
            "id": role_id,
            "name": name,
            "kind": kind,
            "profile": str(row[3]).strip(),
            "voice_condition": voice_style,
            "voice_id": voice_id,
            "rhythm_preset": rhythm_preset,
            "rhythm_prompt": RHYTHM_PRESETS[rhythm_preset],
        }

    segments: list[dict[str, Any]] = []
    orders: set[int] = set()
    for row_number, row in enumerate(segment_rows, start=1):
        if len(row) < len(SEGMENT_HEADERS):
            raise DirectorError(f"分句表第 {row_number} 行字段不足。")
        order = int(float(row[0]))
        role_id = str(row[2]).strip()
        if order in orders:
            raise DirectorError(f"分句表存在重复序号：{order}")
        if role_id not in roles:
            raise DirectorError(f"分句表第 {row_number} 行引用了未知轨道：{role_id}")
        orders.add(order)
        pace_preset = str(row[10]).strip()
        attitude_preset = str(row[7]).strip()
        emotion_label = str(row[8]).strip()
        emotion_direction = str(row[12] or "auto").strip()
        emotion_detail = str(row[13] or "").strip()
        stress_word = str(row[14] or "").strip()
        stress_occurrence = max(1, int(float(row[15] or 1)))
        stress_level = str(row[16] or "none").strip()
        generation_mode = str(row[17] or "standard").strip()
        if pace_preset not in PACE_PRESETS:
            raise DirectorError(f"分句表第 {row_number} 行包含未知句内节奏预设：{pace_preset}")
        if attitude_preset not in ATTITUDE_PRESETS:
            raise DirectorError(f"分句表第 {row_number} 行包含未知态度预设：{attitude_preset}")
        if emotion_label not in EMOTION_VALUES:
            raise DirectorError(f"分句表第 {row_number} 行包含未知情绪预设：{emotion_label}")
        if emotion_direction not in EMOTION_DIRECTION_PRESETS:
            raise DirectorError(f"分句表第 {row_number} 行包含未知情绪演绎预设：{emotion_direction}")
        if emotion_direction == "custom" and not emotion_detail:
            raise DirectorError(f"分句表第 {row_number} 行选择自定义情绪演绎后必须填写细化描述。")
        if len(emotion_detail) > 1000:
            raise DirectorError(f"分句表第 {row_number} 行的情绪细化描述不能超过 1000 个字符。")
        if len(stress_word) > 80:
            raise DirectorError(f"分句表第 {row_number} 行的重音文字不能超过 80 个字符。")
        if stress_level not in {"none", "medium", "strong"}:
            raise DirectorError(f"分句表第 {row_number} 行包含未知重音强度：{stress_level}")
        if generation_mode not in {"standard", "advanced"}:
            raise DirectorError(f"分句表第 {row_number} 行包含未知生成方式：{generation_mode}")
        if stress_word:
            matches = str(row[6]).count(stress_word)
            if matches < stress_occurrence:
                raise DirectorError(f"分句表第 {row_number} 行的合成文本中找不到第 {stress_occurrence} 个重音文字“{stress_word}”。")
            if stress_level == "none":
                raise DirectorError(f"分句表第 {row_number} 行已填写重音文字，请选择重音强度。")
        else:
            stress_occurrence = 1
            stress_level = "none"
        pace, pace_prompt = PACE_PRESETS[pace_preset]
        raw = {
            "order": order,
            "section": str(row[1]).strip() or "正文",
            "speaker_id": role_id,
            "speaker_name": str(row[3]).strip() or roles[role_id]["name"],
            "speaker_kind": roles[role_id]["kind"],
            "language": str(row[4]).strip().upper(),
            "source_text": str(row[5]),
            "text": str(row[6]).strip(),
            "attitude": ATTITUDE_PRESETS[attitude_preset],
            "emotion": EMOTION_VALUES[emotion_label],
            "intensity": row[9],
            "pace": pace,
            "pause_after_ms": row[11],
        }
        normalized = OllamaTextDirector._normalize_segment(raw, row_number)
        normalized["attitude_preset"] = attitude_preset
        normalized["emotion_label"] = emotion_label
        normalized["pace_preset"] = pace_preset
        normalized["pace_prompt"] = pace_prompt
        normalized["emotion_direction"] = emotion_direction
        normalized["emotion_direction_label"] = EMOTION_DIRECTION_PRESETS[emotion_direction][0]
        normalized["emotion_direction_prompt"] = EMOTION_DIRECTION_PRESETS[emotion_direction][1]
        normalized["emotion_detail"] = emotion_detail
        normalized["stress_word"] = stress_word
        normalized["stress_occurrence"] = stress_occurrence
        normalized["stress_level"] = stress_level
        normalized["generation_mode"] = generation_mode
        segments.append(normalized)
    if not roles or not segments:
        raise DirectorError("角色表和分句表不能为空。")
    segments.sort(key=lambda item: item["order"])
    return roles, segments


def segment_emotion_text(role: dict[str, Any], segment: dict[str, Any]) -> str:
    explicit = [
        str(segment.get("emotion_direction_prompt") or "").strip(),
        str(segment.get("emotion_detail") or "").strip(),
    ]
    role_rhythm = str(role.get("rhythm_prompt") or "").strip() if str(segment.get("pace_preset") or "自然") == "自然" else ""
    general = [
        role_rhythm,
        str(segment.get("pace_prompt") or "").strip(),
        str(segment.get("attitude") or "").strip(),
        str(EMOTION_LABELS.get(str(segment.get("emotion") or ""), segment.get("emotion") or "")).strip(),
    ]
    stress_word = str(segment.get("stress_word") or "").strip()
    stress_level = str(segment.get("stress_level") or "none")
    occurrence = int(segment.get("stress_occurrence") or 1)
    stress_prompt = ""
    if stress_word and stress_level != "none":
        degree = "clearly" if stress_level == "medium" else "strongly and unmistakably"
        stress_prompt = (
            f'Place {degree} semantic emphasis on occurrence {occurrence} of the exact text "{stress_word}". '
            "Make that occurrence slightly louder, longer, and more prominent in pitch than its surrounding words, while preserving natural fluent speech"
        )
    parts = [part.rstrip("。.!！ ") for part in [*explicit, stress_prompt, *general] if part]
    return "。".join(parts) + ("。" if parts else "")


def voice_catalog_markdown(demo_voices: dict[str, str]) -> str:
    lines = ["**可用内置音色ID**"]
    lines.extend(f"`{voice_id}`　{label}" for voice_id, label in demo_voices.items())
    lines.append("上传自定义音色后，可在角色表的音色ID中填写上传文件名。")
    return "\n\n".join(lines)


def _build_voice_catalog(
    demo_dir: Path,
    demo_voices: dict[str, str],
    uploaded_files: Iterable[str] | None,
    generated_files: Iterable[str] | None = None,
    voice_library_dir: Path | None = None,
    required_voice_ids: Iterable[str] | None = None,
) -> dict[str, Path]:
    catalog = {voice_id: (demo_dir / voice_id).resolve() for voice_id in demo_voices}
    for voice_id, path in catalog.items():
        if not path.is_file():
            raise DirectorError(f"内置音色文件不存在：{voice_id}")
    for raw_path in [*(uploaded_files or []), *(generated_files or [])]:
        path = Path(str(raw_path)).resolve()
        if not path.is_file():
            raise DirectorError(f"上传音色文件不存在：{path.name}")
        if path.suffix.lower() not in {".wav", ".mp3", ".flac", ".m4a", ".ogg"}:
            raise DirectorError(f"不支持的音色文件格式：{path.name}")
        if path.name in catalog:
            raise DirectorError(f"自定义音色文件名与已有音色冲突：{path.name}")
        catalog[path.name] = path
        if path.stem.startswith(("voice-", "legacy-")):
            catalog[path.stem] = path
    if voice_library_dir is not None:
        library_dir = Path(voice_library_dir).resolve()
        for raw_voice_id in required_voice_ids or []:
            voice_id = str(raw_voice_id or "").strip()
            if not voice_id or voice_id in catalog:
                continue
            stem = Path(voice_id).stem
            if not stem.startswith(("voice-", "legacy-")):
                continue
            path = (library_dir / f"{stem}.wav").resolve()
            if path.parent == library_dir and path.is_file():
                catalog[stem] = path
                catalog[path.name] = path
    return catalog


def _safe_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", value or "", flags=re.UNICODE).strip("-_")
    return cleaned[:48] or fallback


def _wav_format(path: Path) -> tuple[int, int, int]:
    with wave.open(str(path), "rb") as wav_file:
        return wav_file.getframerate(), wav_file.getnchannels(), wav_file.getsampwidth()


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def analyze_segment_candidate(
    path: Path,
    text: str,
    stress_word: str = "",
    occurrence: int = 1,
) -> dict[str, Any]:
    """Measure basic WAV quality and a transparent text-proportional stress proxy."""
    with wave.open(str(path), "rb") as source:
        sample_rate = source.getframerate()
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        frames = source.readframes(source.getnframes())
    if sample_width != 2 or sample_rate <= 0 or not frames:
        return {"quality_passed": False, "score": -100.0, "stress_db": -100.0, "stress_verified": False, "alignment_method": "text_proportional_proxy_v1"}
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    samples /= 32768.0
    duration = len(samples) / sample_rate
    rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    clipping_ratio = float(np.mean(np.abs(samples) >= 0.995)) if len(samples) else 1.0
    silence_ratio = float(np.mean(np.abs(samples) < 0.003)) if len(samples) else 1.0
    quality_passed = 0.2 <= duration <= 90.0 and rms >= 0.002 and peak >= 0.01 and clipping_ratio <= 0.03 and silence_ratio <= 0.92
    stress_db = 0.0
    target_rms = rms
    context_rms = rms
    target_start = -1
    if stress_word and text:
        cursor = 0
        for _ in range(max(1, occurrence)):
            target_start = text.find(stress_word, cursor)
            if target_start < 0:
                break
            cursor = target_start + len(stress_word)
        if target_start >= 0:
            active = np.flatnonzero(np.abs(samples) >= max(0.004, rms * 0.22))
            audio_start = int(active[0]) if len(active) else 0
            audio_end = int(active[-1] + 1) if len(active) else len(samples)
            text_length = max(1, len(text))
            span = max(int(0.08 * sample_rate), int((audio_end - audio_start) * len(stress_word) / text_length))
            center = audio_start + int((audio_end - audio_start) * (target_start + len(stress_word) / 2) / text_length)
            left = max(audio_start, center - span // 2)
            right = min(audio_end, left + span)
            target = samples[left:right]
            before = samples[max(audio_start, left - span):left]
            after = samples[right:min(audio_end, right + span)]
            context = np.concatenate([part for part in (before, after) if len(part)]) if len(before) or len(after) else samples
            target_rms = float(np.sqrt(np.mean(np.square(target)))) if len(target) else rms
            context_rms = float(np.sqrt(np.mean(np.square(context)))) if len(context) else rms
            stress_db = float(20 * math.log10(max(target_rms, 1e-7) / max(context_rms, 1e-7)))
    stress_verified = bool(stress_word and quality_passed and stress_db >= 1.5)
    score = (20.0 if quality_passed else -50.0) + max(-12.0, min(12.0, stress_db)) - clipping_ratio * 100.0 - max(0.0, silence_ratio - 0.6) * 10.0
    return {
        "quality_passed": quality_passed,
        "score": round(score, 4),
        "stress_db": round(stress_db, 4),
        "stress_verified": stress_verified,
        "alignment_method": "text_proportional_proxy_v1",
        "duration_seconds": round(duration, 4),
        "rms": round(rms, 6),
        "peak": round(peak, 6),
        "clipping_ratio": round(clipping_ratio, 6),
        "silence_ratio": round(silence_ratio, 6),
        "target_rms": round(target_rms, 6),
        "context_rms": round(context_rms, 6),
    }


def concatenate_wav_segments(segments: list[dict[str, Any]], output_path: Path) -> None:
    if not segments:
        raise DirectorError("没有可拼接的音频分句。")
    expected = _wav_format(Path(segments[0]["audio_path"]))
    frame_rate, channels, sample_width = expected
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "wb") as output_wav:
        output_wav.setnchannels(channels)
        output_wav.setsampwidth(sample_width)
        output_wav.setframerate(frame_rate)
        for index, segment in enumerate(segments, start=1):
            audio_path = Path(segment["audio_path"])
            if _wav_format(audio_path) != expected:
                raise DirectorError(f"第 {index} 条 WAV 格式与首条不一致。")
            with wave.open(str(audio_path), "rb") as input_wav:
                output_wav.writeframes(input_wav.readframes(input_wav.getnframes()))
            silence_frames = frame_rate * int(segment.get("pause_after_ms", 0)) // 1000
            if silence_frames:
                output_wav.writeframes(b"\0" * channels * sample_width * silence_frames)


def render_directed_audio(
    *,
    document: dict[str, Any],
    role_table: Any,
    segment_table: Any,
    uploaded_files: Iterable[str] | None,
    generated_files: Iterable[str] | None = None,
    model: Any,
    model_lock: Any,
    output_root: Path,
    demo_dir: Path,
    demo_voices: dict[str, str],
    voice_library_dir: Path | None = None,
    pronunciation_table: Any | None = None,
    project_process_dir: Path | None = None,
    force_segment_orders: Iterable[int] | None = None,
    fragment_only_orders: Iterable[int] | None = None,
    advanced_segment_orders: Iterable[int] | None = None,
    cache_only: bool = False,
    progress: Callable[..., Any] | None = None,
    cancel_event: Any | None = None,
) -> tuple[str, str, str, str]:
    roles, segments = tables_to_script(role_table, segment_table)
    pronunciation_rules = normalize_pronunciations(pronunciation_table)
    forced_orders = {int(order) for order in (force_segment_orders or [])}
    fragment_orders = {int(order) for order in (fragment_only_orders or [])}
    advanced_orders = {int(order) for order in (advanced_segment_orders or [])}
    if fragment_orders:
        forced_orders.update(fragment_orders)
    catalog = _build_voice_catalog(
        demo_dir,
        demo_voices,
        uploaded_files,
        generated_files,
        voice_library_dir=voice_library_dir,
        required_voice_ids=(role["voice_id"] for role in roles.values()),
    )
    for role in roles.values():
        if role["voice_id"] not in catalog:
            expected = ""
            if voice_library_dir is not None and Path(role["voice_id"]).stem.startswith(("voice-", "legacy-")):
                expected = f"，预期文件：{(Path(voice_library_dir).resolve() / (Path(role['voice_id']).stem + '.wav'))}"
            raise DirectorError(f"角色 {role['name']} 的当前音色不存在：{role['voice_id']}{expected}。请回到角色卡片重新选择或生成音色")

    base_run_name = (
        f"{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 1_000_000:06d}-"
        f"{_safe_name(str(document.get('title', 'directed-audio')), 'directed-audio')}"
    )
    for attempt in range(100):
        run_name = base_run_name if attempt == 0 else f"{base_run_name}-{attempt:02d}"
        run_dir = output_root / run_name
        try:
            run_dir.mkdir(parents=True, exist_ok=False)
            break
        except FileExistsError:
            continue
    else:
        raise DirectorError("无法分配唯一的音频交付目录，请稍后重试。")
    segment_dir = run_dir / "segments"
    track_dir = run_dir / "tracks"
    chapter_dir = run_dir / "chapters"
    segment_dir.mkdir()
    track_dir.mkdir()
    chapter_dir.mkdir()
    cache_dir = Path(project_process_dir) / "segment-cache" if project_process_dir else None
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[dict[str, Any]] = []
    reused_segments = 0
    voice_digests = {voice_id: _file_digest(path) for voice_id, path in catalog.items() if voice_id in {role["voice_id"] for role in roles.values()}}
    try:
        with model_lock:
            selected_segments = [segment for segment in segments if not fragment_orders or segment["order"] in fragment_orders]
            if fragment_orders and len(selected_segments) != len(fragment_orders):
                missing = sorted(fragment_orders - {segment["order"] for segment in selected_segments})
                raise DirectorError(f"待重新生成的分句不存在：{missing}")
            for index, segment in enumerate(selected_segments, start=1):
                if cancel_event is not None and cancel_event.is_set():
                    raise DirectorCancelled("音频生成已取消。")
                role = roles[segment["speaker_id"]]
                _notify(progress, (index - 1) / len(selected_segments), f"IndexTTS 正在生成 {index}/{len(selected_segments)}｜{role['name']}")
                filename = f"{index:04d}-{_safe_name(role['id'], 'track')}.wav"
                output_path = segment_dir / filename
                emotion_prompt = segment_emotion_text(role, segment)
                effective_text, applied_rules = apply_pronunciations(segment["text"], pronunciation_rules)
                duration_factor = PACE_FACTORS.get(str(segment.get("pace") or "medium"), 1.0)
                advanced_generation = segment.get("generation_mode") == "advanced" or segment["order"] in advanced_orders
                cache_payload = {
                    "text": effective_text,
                    "language": segment["language"],
                    "voice": voice_digests[role["voice_id"]],
                    "emotion": emotion_prompt,
                    "intensity": float(segment["intensity"]),
                    "duration_factor": duration_factor,
                    "stress_word": segment.get("stress_word") or "",
                    "stress_occurrence": int(segment.get("stress_occurrence") or 1),
                    "stress_level": segment.get("stress_level") or "none",
                    "generation_mode": "advanced" if advanced_generation else "standard",
                    "stress_validator": "text_proportional_proxy_v1",
                    "speaker_validator": "campplus_cosine_v1",
                    "speaker_similarity_threshold": SPEAKER_SIMILARITY_THRESHOLD,
                }
                cache_key = hashlib.sha256(
                    json.dumps(cache_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
                ).hexdigest()
                cache_path = cache_dir / f"{cache_key}.wav" if cache_dir else None
                cache_hit = bool(cache_path and cache_path.is_file())
                candidate_results: list[dict[str, Any]] = []
                if cache_hit and segment["order"] not in forced_orders:
                    shutil.copy2(cache_path, output_path)
                    result = str(output_path)
                    reused_segments += 1
                else:
                    if cache_only:
                        raise DirectorError(f"第 {segment['order']} 条分句缺少可串接的已生成片断，请先单独生成该分句。")
                    requested_candidates = 3 if advanced_generation else 1
                    max_attempts = 9 if advanced_generation else 1
                    generated_paths: list[tuple[Path, dict[str, Any]]] = []
                    for candidate_attempt in range(max_attempts):
                        candidate_path = output_path if max_attempts == 1 else output_path.with_name(f"{output_path.stem}-candidate-{candidate_attempt + 1}.wav")
                        result = model.infer(
                            spk_audio_prompt=str(catalog[role["voice_id"]]),
                            text=effective_text,
                            lang=segment["language"],
                            output_path=str(candidate_path),
                            emo_audio_prompt=None,
                            emo_alpha=float(segment["intensity"]),
                            emo_vector=None,
                            use_emo_text=True,
                            emo_text=emotion_prompt,
                            use_random=advanced_generation,
                            duration_factor=duration_factor,
                            max_text_tokens_per_segment=120,
                            verbose=False,
                        )
                        if not result or not candidate_path.is_file():
                            continue
                        metrics = analyze_segment_candidate(
                            candidate_path,
                            effective_text,
                            str(segment.get("stress_word") or ""),
                            int(segment.get("stress_occurrence") or 1),
                        )
                        metrics["audio_quality_passed"] = bool(metrics["quality_passed"])
                        similarity_method = getattr(model, "speaker_similarity", None)
                        similarity = float(similarity_method(str(catalog[role["voice_id"]]), str(candidate_path))) if callable(similarity_method) else None
                        metrics["speaker_similarity"] = round(similarity, 6) if similarity is not None else None
                        metrics["speaker_similarity_threshold"] = SPEAKER_SIMILARITY_THRESHOLD
                        metrics["speaker_verified"] = bool(similarity is not None and similarity >= SPEAKER_SIMILARITY_THRESHOLD)
                        metrics["speaker_validation_method"] = "campplus_cosine_v1" if similarity is not None else "unavailable"
                        metrics["director_verified"] = False
                        metrics["director_validation_method"] = "human_listening_required"
                        stress_required = bool(segment.get("stress_word"))
                        metrics["quality_passed"] = bool(
                            metrics["audio_quality_passed"]
                            and metrics["speaker_verified"]
                            and (not stress_required or metrics["stress_verified"])
                        )
                        metrics["score"] = round(float(metrics["score"]) + (similarity * 100.0 if similarity is not None else -100.0), 4)
                        generated_paths.append((candidate_path, metrics))
                        accepted_paths = [
                            item for item in generated_paths
                            if item[1]["quality_passed"]
                        ]
                        if len(accepted_paths) >= requested_candidates:
                            break
                    valid_candidates = [item for item in generated_paths if item[1]["audio_quality_passed"]] if advanced_generation else generated_paths
                    if len(valid_candidates) < requested_candidates:
                        raise DirectorError(f"第 {segment['order']} 条分句仅生成 {len(valid_candidates)} 个通过基础音频质量验收的候选，需要 {requested_candidates} 个。")
                    selected_candidates = sorted(valid_candidates, key=lambda item: float(item[1]["score"]), reverse=True)[:requested_candidates]
                    candidate_store = Path(project_process_dir) / "segment-candidates" / cache_key if project_process_dir else None
                    if candidate_store:
                        candidate_store.mkdir(parents=True, exist_ok=True)
                    preserve_existing = False
                    previous_cache_path = None
                    if advanced_generation and fragment_orders and project_process_dir:
                        try:
                            previous_index = json.loads((Path(project_process_dir) / "segment-fragments.json").read_text(encoding="utf-8"))
                            for previous_key, previous_item in reversed(list((previous_index.get("fragments") or {}).items())):
                                if (
                                    int(previous_item.get("order") or 0) == int(segment["order"])
                                    and str(previous_item.get("source_text") or "") == str(segment["source_text"])
                                    and str(previous_item.get("text") or "") == str(segment["text"])
                                ):
                                    candidate_previous = Path(project_process_dir) / "segment-cache" / f"{previous_key}.wav"
                                    if candidate_previous.is_file():
                                        previous_cache_path = candidate_previous
                                        preserve_existing = True
                                        break
                        except (OSError, ValueError, TypeError, json.JSONDecodeError):
                            previous_cache_path = None
                    for rank, (candidate_path, metrics) in enumerate(selected_candidates, start=1):
                        candidate_id = hashlib.sha256(f"{cache_key}:{candidate_path.name}:{time.time_ns()}".encode("utf-8")).hexdigest()[:16]
                        if candidate_store:
                            shutil.copy2(candidate_path, candidate_store / f"{candidate_id}.wav")
                        candidate_results.append({
                            "candidate_id": candidate_id,
                            "rank": rank,
                            "selected": rank == 1 and not preserve_existing,
                            **metrics,
                        })
                    chosen_output = previous_cache_path if preserve_existing else selected_candidates[0][0]
                    if chosen_output and chosen_output.resolve() != output_path.resolve():
                        shutil.copy2(chosen_output, output_path)
                    result = str(output_path)
                if not result or not output_path.is_file():
                    raise DirectorError(f"第 {index} 条语音没有生成有效 WAV。")
                if cache_path and (not cache_path.is_file() or segment["order"] in forced_orders):
                    shutil.copy2(output_path, cache_path)
                rendered.append(
                    {
                        **segment,
                        "role": role,
                        "audio_path": output_path,
                        "effective_text": effective_text,
                        "applied_pronunciations": applied_rules,
                        "emotion_text": emotion_prompt,
                        "emotion_weight": float(segment["intensity"]),
                        "duration_factor": duration_factor,
                        "stress_word": segment.get("stress_word") or "",
                        "stress_occurrence": int(segment.get("stress_occurrence") or 1),
                        "stress_level": segment.get("stress_level") or "none",
                        "generation_mode": "advanced" if advanced_generation else "standard",
                        "candidate_results": candidate_results,
                        "selected_candidate_id": next((item["candidate_id"] for item in candidate_results if item["selected"]), ""),
                        "cache_key": cache_key,
                        "cache_reused": cache_hit and segment["order"] not in forced_orders,
                        "forced_regeneration": segment["order"] in forced_orders,
                    }
                )
                if cancel_event is not None and cancel_event.is_set():
                    raise DirectorCancelled("音频生成已取消。")

        if fragment_orders:
            if cache_dir is None:
                raise DirectorError("单句重生成需要工程片断缓存目录。")
            index_path = Path(project_process_dir) / "segment-fragments.json"
            try:
                fragment_index = json.loads(index_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                fragment_index = {"version": 1, "fragments": {}}
            entries = fragment_index.setdefault("fragments", {})
            for item in rendered:
                entries[item["cache_key"]] = {
                    **{key: value for key, value in item.items() if key not in {"audio_path", "role"}},
                    "audio_file": f"{item['cache_key']}.wav",
                    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                }
            temporary = index_path.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(fragment_index, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(index_path)
            status = f"已只重新生成分句 {', '.join(str(order) for order in sorted(fragment_orders))}，其他分句未执行推理。"
            cache_result = str(cache_dir / f"{rendered[0]['cache_key']}.wav")
            shutil.rmtree(run_dir, ignore_errors=True)
            _notify(progress, 1.0, status)
            return cache_result, "", "", status

        master_path = run_dir / "full-audio.wav"
        concatenate_wav_segments(rendered, master_path)
        generated_track_count = 0
        for role_id, role in roles.items():
            role_segments = [item for item in rendered if item["speaker_id"] == role_id]
            if role_segments:
                track_path = track_dir / f"{_safe_name(role_id, 'track')}-{_safe_name(role['name'], 'role')}.wav"
                concatenate_wav_segments(role_segments, track_path)
                generated_track_count += 1

        chapter_outputs: list[dict[str, str]] = []
        chapter_names: list[str] = []
        for item in rendered:
            section = str(item.get("section") or "正文")
            if section not in chapter_names:
                chapter_names.append(section)
        for chapter_index, section in enumerate(chapter_names, start=1):
            chapter_segments = [item for item in rendered if str(item.get("section") or "正文") == section]
            chapter_path = chapter_dir / f"{chapter_index:04d}-{_safe_name(section, 'chapter')}.wav"
            concatenate_wav_segments(chapter_segments, chapter_path)
            chapter_outputs.append({"index": chapter_index, "title": section, "audio": str(Path("chapters") / chapter_path.name)})

        manifest = {
            "version": 2,
            "title": document.get("title", "未命名内容"),
            "content_type": document.get("content_type", "story"),
            "provider": document.get("provider", "ollama"),
            "model": document.get("model", ""),
            "roles": list(roles.values()),
            "generated_role_tracks": generated_track_count,
            "pronunciations": pronunciation_rules,
            "reused_segments": reused_segments,
            "cache_only": cache_only,
            "forced_segment_orders": sorted(forced_orders),
            "chapters": chapter_outputs,
            "segments": [
                {
                    **{key: value for key, value in item.items() if key not in {"audio_path", "role"}},
                    "audio": str(Path("segments") / Path(item["audio_path"]).name),
                }
                for item in rendered
            ],
            "full_audio": master_path.name,
        }
        manifest_path = run_dir / "director-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        csv_path = run_dir / "director-script.csv"
        with csv_path.open("w", encoding="utf-8-sig", newline="") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=SEGMENT_HEADERS)
            writer.writeheader()
            for item in rendered:
                writer.writerow(
                    dict(
                        zip(
                            SEGMENT_HEADERS,
                            [
                                item["order"],
                                item["section"],
                                item["speaker_id"],
                                item["speaker_name"],
                                item["language"],
                                item["source_text"],
                                item["text"],
                                item.get("attitude_preset", item["attitude"]),
                                item.get("emotion_label", EMOTION_LABELS[item["emotion"]]),
                                item["intensity"],
                                item.get("pace_preset", item["pace_prompt"]),
                                item["pause_after_ms"],
                                item.get("emotion_direction", "auto"),
                                item.get("emotion_detail", ""),
                            ],
                        )
                    )
                )

        package_path = run_dir / "directed-audio-package.zip"
        with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(run_dir.rglob("*")):
                if path.is_file() and path != package_path:
                    archive.write(path, path.relative_to(run_dir))
        _notify(progress, 1.0, "完整音频与角色分轨已生成")
        status = (
            f"已生成 {len(rendered)} 条分句、{len(roles)} 个角色配置、{generated_track_count} 个有内容的角色轨道。"
            f"章节音频 {len(chapter_outputs)} 个，复用工程缓存 {reused_segments} 条。"
            f"完整音频：{master_path.name}；交付包包含章节、分句、角色轨道、CSV 和 JSON 清单。"
        )
        return str(master_path), str(package_path), str(manifest_path), status
    except Exception:
        shutil.rmtree(run_dir, ignore_errors=True)
        raise
