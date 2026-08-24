from __future__ import annotations

import csv
import json
import re
import shutil
import time
import wave
import zipfile
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

import requests


CONTENT_TYPES = {
    "自动识别": "auto",
    "小说": "novel",
    "新闻": "news",
    "故事": "story",
}
CONTENT_TYPE_LABELS = {value: key for key, value in CONTENT_TYPES.items() if value != "auto"}
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
PACES = {"slow", "medium", "fast"}
PACE_FACTORS = {"slow": 1.15, "medium": 1.0, "fast": 0.86}
LANGUAGES = {"ZH", "EN", "JA", "ES", "AR"}
ATTRIBUTION_PATTERN = re.compile(
    r"(?:说|说道|问|问道|答|回答|回应|喊|叫|道|补充|解释|宣布|表示|写道|叹道|低语|耳语|吼道|笑道)[^。！？!?]*[：:]\s*$"
)
QUOTE_TRANSLATION = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "„": '"', "‟": '"'})

ROLE_HEADERS = ["轨道ID", "角色", "类型", "角色说明", "音色ID"]
SEGMENT_HEADERS = [
    "序号",
    "章节",
    "轨道ID",
    "角色",
    "语言",
    "原文片段",
    "合成文本",
    "态度语气",
    "情绪",
    "情绪强度",
    "语速",
    "句后停顿ms",
]

DIRECTOR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["content_type", "title", "characters", "segments"],
    "properties": {
        "content_type": {"type": "string", "enum": ["novel", "news", "story"]},
        "title": {"type": "string"},
        "characters": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "name", "kind", "profile", "voice_hint"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "kind": {"type": "string", "enum": sorted(ROLE_KINDS)},
                    "profile": {"type": "string"},
                    "voice_hint": {"type": "string"},
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
                    "language": {"type": "string", "enum": sorted(LANGUAGES)},
                    "source_text": {"type": "string"},
                    "text": {"type": "string"},
                    "attitude": {"type": "string"},
                    "emotion": {"type": "string", "enum": sorted(EMOTIONS)},
                    "intensity": {"type": "number", "minimum": 0, "maximum": 1},
                    "pace": {"type": "string", "enum": sorted(PACES)},
                    "pause_after_ms": {"type": "integer", "minimum": 0, "maximum": 3000},
                },
            },
        },
    },
}


class DirectorError(RuntimeError):
    pass


@dataclass(frozen=True)
class DirectorConfig:
    base_url: str = "http://127.0.0.1:11434"
    model: str = "qwen3:14b"
    timeout_seconds: int = 300
    max_chunk_chars: int = 3600


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


def split_document(text: str, max_chars: int = 3600) -> list[str]:
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
        chunk = source[start:end]
        if chunk:
            chunks.append(chunk)
        start = end
    return chunks


class OllamaTextDirector:
    def __init__(self, config: DirectorConfig):
        self.config = config
        self.base_url = config.base_url.rstrip("/")

    def list_models(self) -> list[str]:
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=10)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise DirectorError(f"无法连接本地 AI 服务 {self.base_url}：{exc}") from exc
        return [str(item.get("name", "")) for item in response.json().get("models", []) if item.get("name")]

    def health_summary(self) -> str:
        models = self.list_models()
        if self.config.model not in models:
            available = "、".join(models) if models else "无"
            raise DirectorError(f"AI 模型 {self.config.model} 不可用。当前模型：{available}")
        return f"本地 AI 已连接｜{self.config.model}｜{self.base_url}"

    def analyze_document(
        self,
        text: str,
        content_type: str = "auto",
        guidance: str = "",
        progress: Callable[..., Any] | None = None,
    ) -> dict[str, Any]:
        source = normalize_source_text(text)
        if not source:
            raise DirectorError("请输入需要处理的完整文字。")
        if content_type not in {"auto", "novel", "news", "story"}:
            raise DirectorError(f"不支持的内容体裁：{content_type}")

        chunks = split_document(source, self.config.max_chunk_chars)
        if not chunks:
            raise DirectorError("输入文字没有可处理内容。")

        global_characters: list[dict[str, Any]] = []
        global_segments: list[dict[str, Any]] = []
        detected_type: str | None = None
        title = "未命名内容"
        metrics = {"prompt_tokens": 0, "output_tokens": 0, "duration_seconds": 0.0, "chunks": len(chunks)}
        previous_context = ""

        for index, chunk in enumerate(chunks, start=1):
            _notify(progress, (index - 1) / len(chunks), f"AI 正在导演第 {index}/{len(chunks)} 个文本块")
            result, result_metrics = self._analyze_chunk(
                chunk=chunk,
                chunk_index=index,
                chunk_count=len(chunks),
                requested_type=content_type,
                existing_characters=global_characters,
                previous_context=previous_context,
                guidance=guidance,
            )
            metrics["prompt_tokens"] += result_metrics["prompt_tokens"]
            metrics["output_tokens"] += result_metrics["output_tokens"]
            metrics["duration_seconds"] += result_metrics["duration_seconds"]
            if detected_type is None:
                detected_type = result["content_type"]
                title = result["title"].strip() or title
            self._merge_chunk(result, global_characters, global_segments)
            previous_context = chunk[-400:]

        for order, segment in enumerate(global_segments, start=1):
            segment["order"] = order

        _notify(progress, 1.0, "AI 文本导演完成")
        return {
            "version": 1,
            "provider": "ollama",
            "model": self.config.model,
            "content_type": detected_type or (content_type if content_type != "auto" else "story"),
            "title": title,
            "original_text": source,
            "cleaned_text": "\n".join(segment["text"] for segment in global_segments),
            "characters": global_characters,
            "segments": global_segments,
            "metrics": metrics,
        }

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
                return self._validate_chunk(result, chunk), metrics
            except (DirectorError, ValueError, TypeError, json.JSONDecodeError) as exc:
                last_error = exc
        raise DirectorError(f"AI 连续两次未生成可验证的完整分轨：{last_error}")

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
        type_instruction = {
            "auto": "智能判断 novel、news、story 中最合适的体裁。",
            "novel": "体裁固定为 novel。旁白负责环境、动作、心理和说话归属；人物台词独立分轨。",
            "news": "体裁固定为 news。主播保持客观克制；记者、采访对象分别分轨。",
            "story": "体裁固定为 story。旁白具有讲述感，人物台词保持可辨识的态度变化。",
        }[requested_type]
        roster = json.dumps(existing_characters, ensure_ascii=False, separators=(",", ":"))
        schema_text = json.dumps(DIRECTOR_SCHEMA, ensure_ascii=False, separators=(",", ":"))
        return f"""
你是专业有声内容导演和中文文本编辑。处理第 {chunk_index}/{chunk_count} 个连续文本块。

任务要求：
1. 清理适合朗读的文本，修正多余空白和明显排版噪声，不改变事实、人物关系和原意。
2. 智能识别自然段、段内句子、人物、旁白、主播、记者和采访对象，每个可独立配音的句子形成一条 segment。
3. 旁白和说话归属文字也必须保留并单独成句。例如“李明说：”属于旁白，不能只保留引号内台词。
4. 每条 source_text 必须从本次原文中按顺序逐字复制。全部 source_text 拼接后必须与本次原文完全一致，允许的差异只有空白字符。
5. text 是对应 source_text 的可朗读清洗稿。去除只用于排版的外层引号，不得遗漏可朗读信息。
6. 标注具体态度语气、八类情绪、0 到 1 情绪强度、slow/medium/fast 语速和 0 到 3000 毫秒句后停顿。
7. 每条 segment 标注 ZH、EN、JA、ES、AR 之一。混合语言按主要朗读语言拆句。
8. 人物必须使用稳定 ID。优先复用已有角色；旁白固定使用 narrator。
9. {type_instruction}
10. 用户导演补充：{guidance.strip() or '无'}

已有角色表：{roster or '[]'}
上一文本块结尾，仅用于人物连续性，不要重复输出：{previous_context or '无'}

本次原文开始：
<<<SOURCE
{chunk}
SOURCE

JSON Schema：{schema_text}
只输出符合 Schema 的 JSON，不输出说明文字。
""".strip()

    def _chat(self, prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
        body = {
            "model": self.config.model,
            "stream": False,
            "think": False,
            "keep_alive": "30m",
            "format": DIRECTOR_SCHEMA,
            "messages": [
                {
                    "role": "system",
                    "content": "你只输出严格符合 JSON Schema 的有声导演结果，完整保留原文可朗读信息。",
                },
                {"role": "user", "content": prompt},
            ],
            "options": {"temperature": 0, "seed": 42, "num_ctx": 8192},
        }
        started = time.perf_counter()
        try:
            response = requests.post(
                f"{self.base_url}/api/chat",
                json=body,
                timeout=self.config.timeout_seconds,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise DirectorError(f"本地 AI 调用失败：{exc}") from exc
        payload = response.json()
        content = payload.get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            raise DirectorError("本地 AI 返回了空结果。")
        result = json.loads(content)
        metrics = {
            "prompt_tokens": int(payload.get("prompt_eval_count") or 0),
            "output_tokens": int(payload.get("eval_count") or 0),
            "duration_seconds": round(time.perf_counter() - started, 3),
        }
        return result, metrics

    def _validate_chunk(self, result: dict[str, Any], source: str) -> dict[str, Any]:
        if not isinstance(result, dict):
            raise DirectorError("AI 结果不是 JSON 对象。")
        content_type = str(result.get("content_type", ""))
        if content_type not in {"novel", "news", "story"}:
            raise DirectorError("AI 结果缺少有效体裁。")
        raw_characters = result.get("characters")
        raw_segments = result.get("segments")
        if not isinstance(raw_characters, list) or not isinstance(raw_segments, list) or not raw_segments:
            raise DirectorError("AI 结果缺少角色或分句。")

        characters: list[dict[str, Any]] = []
        character_ids: set[str] = set()
        for raw in raw_characters:
            if not isinstance(raw, dict):
                raise DirectorError("角色项格式无效。")
            character = self._normalize_character(raw)
            if character["id"] in character_ids:
                continue
            character_ids.add(character["id"])
            characters.append(character)

        segments: list[dict[str, Any]] = []
        for index, raw in enumerate(raw_segments, start=1):
            if not isinstance(raw, dict):
                raise DirectorError(f"第 {index} 条分句格式无效。")
            segment = self._normalize_segment(raw, index)
            if segment["speaker_kind"] == "character" and is_speech_attribution(segment["source_text"]):
                segment["speaker_id"] = "narrator"
                segment["speaker_name"] = "旁白"
                segment["speaker_kind"] = "narrator"
            segments.append(segment)

        restore_exact_source_text(segments, source)
        segments = self._split_embedded_dialogue(segments, characters)
        character_ids = {character["id"] for character in characters}
        for segment in segments:
            if segment["speaker_id"] not in character_ids:
                inferred = self._normalize_character(
                    {
                        "id": segment["speaker_id"],
                        "name": segment["speaker_name"],
                        "kind": segment["speaker_kind"],
                        "profile": "由分句引用补全",
                        "voice_hint": "根据角色内容选择",
                    }
                )
                characters.append(inferred)
                character_ids.add(inferred["id"])

        reconstructed = "".join(segment["source_text"] for segment in segments)
        if coverage_key(reconstructed) != coverage_key(source):
            raise DirectorError("source_text 未完整覆盖本次原文，存在遗漏、改写或顺序变化。")

        return {
            "content_type": content_type,
            "title": str(result.get("title", "")).strip() or "未命名内容",
            "characters": characters,
            "segments": segments,
        }

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
            for opening, closing in (("“", "”"), ('"', '"')):
                start = source_text.find(opening)
                end = source_text.rfind(closing)
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
                matched = next((character for character in speakers if character["name"] in prefix), None)
                if matched is None:
                    inferred_name = OllamaTextDirector._infer_quoted_speaker(prefix)
                    if inferred_name:
                        matched = {
                            "id": f"inferred-{len(speakers) + 1}",
                            "name": inferred_name,
                            "kind": "character",
                            "profile": "由说话归属文字识别",
                            "voice_hint": "根据角色内容选择",
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
    def _infer_quoted_speaker(prefix: str) -> str:
        compact = re.sub(r"\s+", "", prefix)
        patterns = (
            r"(?:传来|响起|听见|听到)([\u4e00-\u9fff]{1,6})的(?:喊声|声音|叫声|低语)",
            r"([\u4e00-\u9fff]{1,6})在[^，。！？；：]{0,16}(?:说|问|答|回应|喊|叫|道)[：:]$",
            r"([\u4e00-\u9fff]{1,6})(?:冷冷|轻声|大声|焦急|平静|愤怒)?(?:地)?(?:说|问|答|回应|喊|叫|道)[：:]$",
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
            name = name or "旁白"
        return {
            "id": role_id,
            "name": name,
            "kind": kind,
            "profile": str(raw.get("profile", "")).strip(),
            "voice_hint": str(raw.get("voice_hint", "")).strip(),
        }

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
            speaker_name = speaker_name or "旁白"
        if not source_text or not text or not attitude:
            raise DirectorError(f"第 {default_order} 条分句缺少原文、合成文本或态度。")
        if len(text) > 1200:
            raise DirectorError(f"第 {default_order} 条合成文本超过 1200 字符。")
        if emotion not in EMOTIONS or pace not in PACES or language not in LANGUAGES:
            raise DirectorError(f"第 {default_order} 条分句的情绪、语速或语言无效。")
        intensity = max(0.0, min(1.0, float(raw.get("intensity", 0.65))))
        pause_after_ms = max(0, min(3000, int(raw.get("pause_after_ms", 400))))
        return {
            "order": int(raw.get("order") or default_order),
            "section": str(raw.get("section", "正文")).strip() or "正文",
            "speaker_id": speaker_id,
            "speaker_name": speaker_name,
            "speaker_kind": speaker_kind,
            "language": language,
            "source_text": source_text,
            "text": text,
            "attitude": attitude,
            "emotion": emotion,
            "intensity": round(intensity, 2),
            "pace": pace,
            "pause_after_ms": pause_after_ms,
        }

    @staticmethod
    def _merge_chunk(
        result: dict[str, Any],
        global_characters: list[dict[str, Any]],
        global_segments: list[dict[str, Any]],
    ) -> None:
        role_by_key = {(item["kind"], item["name"].strip().casefold()): item for item in global_characters}
        local_to_global: dict[str, str] = {}
        for character in result["characters"]:
            key = (character["kind"], character["name"].strip().casefold())
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
            local_to_global[character["id"]] = existing["id"]

        for segment in result["segments"]:
            merged = deepcopy(segment)
            role_key = (merged["speaker_kind"], merged["speaker_name"].strip().casefold())
            role = role_by_key.get(role_key)
            if role is None:
                role = {
                    "id": "narrator" if merged["speaker_kind"] == "narrator" else f"role_{len(global_characters) + 1:03d}",
                    "name": merged["speaker_name"],
                    "kind": merged["speaker_kind"],
                    "profile": "由分句引用补全",
                    "voice_hint": "根据角色内容选择",
                }
                global_characters.append(role)
                role_by_key[role_key] = role
            merged["speaker_id"] = role["id"]
            global_segments.append(merged)


def document_to_tables(document: dict[str, Any], demo_voice_ids: Iterable[str]) -> tuple[list[list[Any]], list[list[Any]]]:
    voice_ids = list(demo_voice_ids)
    if not voice_ids:
        raise DirectorError("没有可用于角色分配的演示音色。")
    roles: list[list[Any]] = []
    non_narrator_index = 0
    for character in document.get("characters", []):
        if character["kind"] in {"narrator", "anchor"}:
            preferred = "voice_05.wav" if "voice_05.wav" in voice_ids else voice_ids[0]
        else:
            preferred = voice_ids[non_narrator_index % len(voice_ids)]
            non_narrator_index += 1
        roles.append(
            [
                character["id"],
                character["name"],
                character["kind"],
                character.get("profile") or character.get("voice_hint", ""),
                preferred,
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
            segment["attitude"],
            segment["emotion"],
            segment["intensity"],
            segment["pace"],
            segment["pause_after_ms"],
        ]
        for segment in document.get("segments", [])
    ]
    return roles, segments


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
    segment_rows = _table_rows(segment_table)
    roles: dict[str, dict[str, Any]] = {}
    for row_number, row in enumerate(role_rows, start=1):
        if len(row) < len(ROLE_HEADERS):
            raise DirectorError(f"角色表第 {row_number} 行字段不足。")
        role_id = str(row[0]).strip()
        name = str(row[1]).strip()
        kind = str(row[2]).strip()
        voice_id = str(row[4]).strip()
        if not role_id or not name or kind not in ROLE_KINDS or not voice_id:
            raise DirectorError(f"角色表第 {row_number} 行包含无效角色或音色。")
        if role_id in roles:
            raise DirectorError(f"角色表存在重复轨道ID：{role_id}")
        roles[role_id] = {"id": role_id, "name": name, "kind": kind, "profile": str(row[3]).strip(), "voice_id": voice_id}

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
        raw = {
            "order": order,
            "section": str(row[1]).strip() or "正文",
            "speaker_id": role_id,
            "speaker_name": str(row[3]).strip() or roles[role_id]["name"],
            "speaker_kind": roles[role_id]["kind"],
            "language": str(row[4]).strip().upper(),
            "source_text": str(row[5]),
            "text": str(row[6]).strip(),
            "attitude": str(row[7]).strip(),
            "emotion": str(row[8]).strip(),
            "intensity": row[9],
            "pace": str(row[10]).strip(),
            "pause_after_ms": row[11],
        }
        segments.append(OllamaTextDirector._normalize_segment(raw, row_number))
    if not roles or not segments:
        raise DirectorError("角色表和分句表不能为空。")
    segments.sort(key=lambda item: item["order"])
    return roles, segments


def voice_catalog_markdown(demo_voices: dict[str, str]) -> str:
    lines = ["**可用内置音色ID**"]
    lines.extend(f"`{voice_id}`　{label}" for voice_id, label in demo_voices.items())
    lines.append("上传自定义音色后，可在角色表的音色ID中填写上传文件名。")
    return "\n\n".join(lines)


def _build_voice_catalog(
    demo_dir: Path,
    demo_voices: dict[str, str],
    uploaded_files: Iterable[str] | None,
) -> dict[str, Path]:
    catalog = {voice_id: (demo_dir / voice_id).resolve() for voice_id in demo_voices}
    for voice_id, path in catalog.items():
        if not path.is_file():
            raise DirectorError(f"内置音色文件不存在：{voice_id}")
    for raw_path in uploaded_files or []:
        path = Path(str(raw_path)).resolve()
        if not path.is_file():
            raise DirectorError(f"上传音色文件不存在：{path.name}")
        if path.suffix.lower() not in {".wav", ".mp3", ".flac", ".m4a", ".ogg"}:
            raise DirectorError(f"不支持的音色文件格式：{path.name}")
        if path.name in catalog:
            raise DirectorError(f"自定义音色文件名与已有音色冲突：{path.name}")
        catalog[path.name] = path
    return catalog


def _safe_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", value or "", flags=re.UNICODE).strip("-_")
    return cleaned[:48] or fallback


def _wav_format(path: Path) -> tuple[int, int, int]:
    with wave.open(str(path), "rb") as wav_file:
        return wav_file.getframerate(), wav_file.getnchannels(), wav_file.getsampwidth()


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
    model: Any,
    model_lock: Any,
    output_root: Path,
    demo_dir: Path,
    demo_voices: dict[str, str],
    progress: Callable[..., Any] | None = None,
) -> tuple[str, str, str, str]:
    roles, segments = tables_to_script(role_table, segment_table)
    catalog = _build_voice_catalog(demo_dir, demo_voices, uploaded_files)
    for role in roles.values():
        if role["voice_id"] not in catalog:
            available = "、".join(catalog)
            raise DirectorError(f"角色 {role['name']} 的音色ID不存在：{role['voice_id']}。可用：{available}")

    run_name = f"{time.strftime('%Y%m%d-%H%M%S')}-{_safe_name(str(document.get('title', 'directed-audio')), 'directed-audio')}"
    run_dir = output_root / run_name
    segment_dir = run_dir / "segments"
    track_dir = run_dir / "tracks"
    segment_dir.mkdir(parents=True, exist_ok=False)
    track_dir.mkdir(parents=True, exist_ok=False)
    rendered: list[dict[str, Any]] = []
    try:
        with model_lock:
            for index, segment in enumerate(segments, start=1):
                role = roles[segment["speaker_id"]]
                _notify(progress, (index - 1) / len(segments), f"IndexTTS 正在生成 {index}/{len(segments)}｜{role['name']}")
                filename = f"{index:04d}-{_safe_name(role['id'], 'track')}.wav"
                output_path = segment_dir / filename
                emotion_prompt = f"{segment['attitude']}。{EMOTION_LABELS[segment['emotion']]}。"
                result = model.infer(
                    spk_audio_prompt=str(catalog[role["voice_id"]]),
                    text=segment["text"],
                    lang=segment["language"],
                    output_path=str(output_path),
                    emo_audio_prompt=None,
                    emo_alpha=float(segment["intensity"]),
                    emo_vector=None,
                    use_emo_text=True,
                    emo_text=emotion_prompt,
                    use_random=False,
                    duration_factor=PACE_FACTORS[segment["pace"]],
                    max_text_tokens_per_segment=120,
                    verbose=False,
                )
                if not result or not output_path.is_file():
                    raise DirectorError(f"第 {index} 条语音没有生成有效 WAV。")
                rendered.append({**segment, "role": role, "audio_path": output_path})

        master_path = run_dir / "full-audio.wav"
        concatenate_wav_segments(rendered, master_path)
        for role_id, role in roles.items():
            role_segments = [item for item in rendered if item["speaker_id"] == role_id]
            if role_segments:
                track_path = track_dir / f"{_safe_name(role_id, 'track')}-{_safe_name(role['name'], 'role')}.wav"
                concatenate_wav_segments(role_segments, track_path)

        manifest = {
            "version": 1,
            "title": document.get("title", "未命名内容"),
            "content_type": document.get("content_type", "story"),
            "provider": document.get("provider", "ollama"),
            "model": document.get("model", ""),
            "roles": list(roles.values()),
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
                                item["attitude"],
                                item["emotion"],
                                item["intensity"],
                                item["pace"],
                                item["pause_after_ms"],
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
            f"已生成 {len(rendered)} 条分句、{len(roles)} 个角色轨道。"
            f"完整音频：{master_path.name}；交付包包含分句 WAV、角色轨道、CSV 和 JSON 清单。"
        )
        return str(master_path), str(package_path), str(manifest_path), status
    except Exception:
        shutil.rmtree(run_dir, ignore_errors=True)
        raise
