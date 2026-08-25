from __future__ import annotations

import hashlib
import json
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Iterable


PROJECT_VERSION = 1
PRONUNCIATION_HEADERS = ["原词组合", "朗读替换", "说明", "启用"]
CHAPTER_PATTERN = re.compile(
    r"(?m)^[ \t]*(第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇]|Chapter\s+\d+)\s*[^\n]*$",
    re.IGNORECASE,
)


class ProjectError(ValueError):
    pass


def safe_slug(value: str, fallback: str = "novel") -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff]+", "-", str(value or ""), flags=re.UNICODE).strip("-_")
    return cleaned[:48] or fallback


def split_chapters(text: str) -> list[dict[str, Any]]:
    source = str(text or "")
    matches = list(CHAPTER_PATTERN.finditer(source))
    if not matches:
        return [{"index": 1, "title": "全文", "start": 0, "end": len(source)}] if source else []
    boundaries: list[tuple[int, str]] = []
    if matches[0].start() > 0:
        boundaries.append((0, "序章"))
    boundaries.extend((match.start(), match.group(0).strip()) for match in matches)
    chapters: list[dict[str, Any]] = []
    for index, (start, title) in enumerate(boundaries, start=1):
        end = boundaries[index][0] if index < len(boundaries) else len(source)
        chapters.append({"index": index, "title": title, "start": start, "end": end})
    return chapters


def normalize_pronunciations(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if hasattr(value, "values") and hasattr(value.values, "tolist"):
        rows = value.values.tolist()
    elif hasattr(value, "tolist"):
        rows = value.tolist()
    elif isinstance(value, list):
        rows = value
    else:
        raise ProjectError("纠音表格式无效。")
    rules: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row_number, row in enumerate(rows, start=1):
        if not row or not any(str(item or "").strip() for item in row):
            continue
        if len(row) < len(PRONUNCIATION_HEADERS):
            raise ProjectError(f"纠音表第 {row_number} 行字段不足。")
        source = str(row[0] or "").strip()
        replacement = str(row[1] or "").strip()
        if not source or not replacement:
            raise ProjectError(f"纠音表第 {row_number} 行必须填写原词组合和朗读替换。")
        if source in seen:
            raise ProjectError(f"纠音表存在重复原词组合：{source}")
        seen.add(source)
        enabled_text = str(row[3] if row[3] is not None else "是").strip().lower()
        rules.append(
            {
                "source": source,
                "replacement": replacement,
                "note": str(row[2] or "").strip(),
                "enabled": enabled_text not in {"否", "false", "0", "禁用", "off"},
            }
        )
    return rules


def pronunciation_rows(rules: Iterable[dict[str, Any]] | None) -> list[list[Any]]:
    return [
        [rule.get("source", ""), rule.get("replacement", ""), rule.get("note", ""), "是" if rule.get("enabled", True) else "否"]
        for rule in (rules or [])
    ]


def apply_pronunciations(text: str, rules: Iterable[dict[str, Any]]) -> tuple[str, list[str]]:
    result = str(text or "")
    applied: list[str] = []
    active = sorted(
        (rule for rule in rules if rule.get("enabled", True)),
        key=lambda rule: len(str(rule.get("source", ""))),
        reverse=True,
    )
    for rule in active:
        source = str(rule.get("source", ""))
        replacement = str(rule.get("replacement", ""))
        if source and source in result:
            result = result.replace(source, replacement)
            applied.append(source)
    return result, applied


def voice_signature(job: dict[str, Any], *, model: str, seed: int) -> str:
    payload = {
        "instruct": str(job.get("instruct", "")).strip(),
        "language": str(job.get("language", "Auto")),
        "text": str(job.get("text", "")).strip(),
        "model": str(model),
        "seed": int(seed),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class NovelProjectStore:
    def __init__(self, root: Path, voice_library_root: Path):
        self.root = Path(root)
        self.voice_library_root = Path(voice_library_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.voice_library_root.mkdir(parents=True, exist_ok=True)

    def project_dir(self, project_id: str) -> Path:
        project_id = str(project_id or "").strip()
        if not project_id or project_id != Path(project_id).name or not re.fullmatch(r"[\w\-.\u4e00-\u9fff]+", project_id):
            raise ProjectError("小说工程 ID 无效。")
        return self.root / project_id

    def create(self, title: str, content_type: str = "novel", source_text: str = "", guidance: str = "") -> dict[str, Any]:
        cleaned_title = str(title or "").strip()
        if not cleaned_title:
            raise ProjectError("请填写小说工程名称。")
        project_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{safe_slug(cleaned_title)}-{uuid.uuid4().hex[:6]}"
        project_dir = self.project_dir(project_id)
        for child in ("voices", "process", "renders", "analysis"):
            (project_dir / child).mkdir(parents=True, exist_ok=True)
        now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        payload = {
            "version": PROJECT_VERSION,
            "project_id": project_id,
            "title": cleaned_title,
            "content_type": content_type,
            "source_text": str(source_text or ""),
            "guidance": str(guidance or ""),
            "chapters": split_chapters(source_text),
            "document": {},
            "roles": [],
            "segments": [],
            "pronunciations": [],
            "voice_files": [],
            "created_at": now,
            "updated_at": now,
        }
        self._write(project_dir / "project.json", payload)
        return payload

    def list_projects(self) -> list[tuple[str, str]]:
        choices: list[tuple[str, str]] = []
        for path in sorted(self.root.glob("*/project.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                label = f"{payload.get('title', path.parent.name)}｜{path.parent.name}"
                choices.append((label, path.parent.name))
            except (OSError, json.JSONDecodeError):
                continue
        return choices

    def load(self, project_id: str) -> dict[str, Any]:
        path = self.project_dir(project_id) / "project.json"
        if not path.is_file():
            raise ProjectError("小说工程不存在。")
        payload = json.loads(path.read_text(encoding="utf-8"))
        if int(payload.get("version", 0)) != PROJECT_VERSION:
            raise ProjectError(f"小说工程版本不受支持：{payload.get('version')}")
        return payload

    def save(
        self,
        project_id: str,
        *,
        title: str,
        content_type: str,
        source_text: str,
        guidance: str,
        document: dict[str, Any] | None,
        roles: list[list[Any]],
        segments: list[list[Any]],
        pronunciations: Any,
        voice_files: Iterable[str] | None,
    ) -> dict[str, Any]:
        payload = self.load(project_id)
        payload.update(
            {
                "title": str(title or payload.get("title") or "未命名小说").strip(),
                "content_type": str(content_type or "novel"),
                "source_text": str(source_text or ""),
                "guidance": str(guidance or ""),
                "chapters": split_chapters(source_text),
                "document": document or {},
                "roles": roles or [],
                "segments": segments or [],
                "pronunciations": normalize_pronunciations(pronunciations),
                "voice_files": [str(Path(path).resolve()) for path in (voice_files or []) if Path(str(path)).is_file()],
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
        )
        self._write(self.project_dir(project_id) / "project.json", payload)
        return payload

    def register_voice(self, generated_path: str | Path, job: dict[str, Any], *, model: str, seed: int = 42) -> dict[str, Any]:
        source = Path(generated_path).resolve()
        if not source.is_file():
            raise ProjectError(f"生成音色文件不存在：{source.name}")
        signature = voice_signature(job, model=model, seed=seed)
        voice_id = f"voice-{signature[:16]}"
        audio_path = self.voice_library_root / f"{voice_id}.wav"
        metadata_path = self.voice_library_root / f"{voice_id}.json"
        if not audio_path.is_file():
            shutil.copy2(source, audio_path)
        metadata = {
            "version": 1,
            "voice_id": voice_id,
            "audio_path": str(audio_path.resolve()),
            "signature": signature,
            "name": str(job.get("name", "")),
            "role_id": str(job.get("role_id", "")),
            "instruct": str(job.get("instruct", "")),
            "language": str(job.get("language", "Auto")),
            "text": str(job.get("text", "")),
            "model": str(model),
            "seed": int(seed),
            "expected_gender": str(job.get("expected_gender", "unspecified")),
            "median_pitch_hz": job.get("median_pitch_hz"),
            "gender_verified": bool(job.get("gender_verified", False)),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        self._write(metadata_path, metadata)
        return metadata

    def find_voice(self, job: dict[str, Any], *, model: str, seed: int = 42) -> dict[str, Any] | None:
        signature = voice_signature(job, model=model, seed=seed)
        metadata_path = self.voice_library_root / f"voice-{signature[:16]}.json"
        if not metadata_path.is_file():
            return None
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("quarantined"):
            return None
        expected_gender = str(job.get("expected_gender") or "unspecified")
        if expected_gender in {"female", "male"} and (
            str(metadata.get("expected_gender")) != expected_gender or not metadata.get("gender_verified")
        ):
            return None
        if Path(str(metadata.get("audio_path", ""))).is_file():
            return metadata
        return None

    def list_voices(self) -> list[dict[str, Any]]:
        voices: list[dict[str, Any]] = []
        for path in sorted(self.voice_library_root.glob("*.json")):
            try:
                metadata = json.loads(path.read_text(encoding="utf-8"))
                if not metadata.get("quarantined") and Path(str(metadata.get("audio_path", ""))).is_file():
                    voices.append(metadata)
            except (OSError, json.JSONDecodeError):
                continue
        return voices

    def import_legacy_voice(self, source_path: str | Path, name: str = "历史角色音色") -> dict[str, Any]:
        source = Path(source_path).resolve()
        if not source.is_file():
            raise ProjectError(f"历史音色文件不存在：{source.name}")
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        voice_id = f"legacy-{digest[:16]}"
        audio_path = self.voice_library_root / f"{voice_id}.wav"
        metadata_path = self.voice_library_root / f"{voice_id}.json"
        if not audio_path.is_file():
            shutil.copy2(source, audio_path)
        metadata = {
            "version": 1,
            "voice_id": voice_id,
            "audio_path": str(audio_path.resolve()),
            "signature": digest,
            "name": str(name or source.stem),
            "role_id": "",
            "instruct": "历史版本生成的音色，原始设计条件没有被旧版保存。",
            "language": "Auto",
            "text": "",
            "model": "legacy-import",
            "seed": None,
            "source_path": str(source),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        self._write(metadata_path, metadata)
        return metadata

    @staticmethod
    def _write(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
