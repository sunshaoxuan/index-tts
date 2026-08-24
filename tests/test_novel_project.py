import json
import wave
from pathlib import Path

import pytest

from novel_project import (
    NovelProjectStore,
    ProjectError,
    apply_pronunciations,
    normalize_pronunciations,
    split_chapters,
    voice_signature,
)


def _write_wav(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(22050)
        output.writeframes(b"\x00\x00" * 100)


def test_chapter_index_preserves_exact_boundaries():
    source = "序言。\n第一章 雨夜\n正文一。\n第二章 清晨\n正文二。"
    chapters = split_chapters(source)

    assert [item["title"] for item in chapters] == ["序章", "第一章 雨夜", "第二章 清晨"]
    assert "".join(source[item["start"] : item["end"]] for item in chapters) == source


def test_project_round_trip_keeps_roles_segments_pronunciations_and_chapters(tmp_path):
    store = NovelProjectStore(tmp_path / "projects", tmp_path / "voices")
    source = "第一章 开始\n重庆银行。\n第二章 继续\n故事继续。"
    project = store.create("长篇测试", "novel", source, "克制")
    roles = [["narrator", "旁白", "narrator", "沉稳", "厚实", "voice_05.wav", "沉稳舒缓，短语间自然停连", "否"]]
    segments = [[1, "第一章", "narrator", "旁白", "ZH", "重庆银行。", "重庆银行。", "平静", "calm", 0.5, "短语间停连清晰", 300]]
    saved = store.save(
        project["project_id"],
        title="长篇测试",
        content_type="novel",
        source_text=source,
        guidance="克制",
        document={"title": "长篇测试"},
        roles=roles,
        segments=segments,
        pronunciations=[["重庆银行", "重 庆 银行", "专名", "是"]],
        voice_files=[],
    )
    loaded = store.load(project["project_id"])

    assert loaded == saved
    assert loaded["roles"] == roles
    assert loaded["segments"] == segments
    assert len(loaded["chapters"]) == 2
    assert loaded["pronunciations"][0]["replacement"] == "重 庆 银行"


def test_voice_registration_is_idempotent_and_keeps_generation_conditions(tmp_path):
    store = NovelProjectStore(tmp_path / "projects", tmp_path / "voices")
    generated = tmp_path / "generated.wav"
    _write_wav(generated)
    job = {
        "role_id": "role_001",
        "name": "林舟",
        "language": "Chinese",
        "text": "这是我的声音。",
        "instruct": "青年，克制，清澈。",
    }
    first = store.register_voice(generated, job, model="voice-model", seed=42)
    second = store.register_voice(generated, job, model="voice-model", seed=42)

    assert first["voice_id"] == second["voice_id"]
    assert first["audio_path"] == second["audio_path"]
    assert Path(first["audio_path"]).is_file()
    assert first["instruct"] == job["instruct"]
    assert store.find_voice(job, model="voice-model", seed=42)["voice_id"] == first["voice_id"]
    assert voice_signature(job, model="voice-model", seed=42) != voice_signature(job, model="voice-model", seed=43)


def test_legacy_voice_import_preserves_existing_audio_with_stable_id(tmp_path):
    store = NovelProjectStore(tmp_path / "projects", tmp_path / "voices")
    legacy = tmp_path / "old-role.wav"
    _write_wav(legacy)

    first = store.import_legacy_voice(legacy, "旧版林舟")
    second = store.import_legacy_voice(legacy, "旧版林舟")

    assert first["voice_id"] == second["voice_id"]
    assert first["voice_id"].startswith("legacy-")
    assert Path(first["audio_path"]).read_bytes() == legacy.read_bytes()
    assert "没有被旧版保存" in first["instruct"]


def test_pronunciation_rules_use_longest_match_and_reject_duplicates():
    rules = normalize_pronunciations(
        [
            ["重庆银行", "重 庆 银行", "机构", "是"],
            ["重庆", "重 庆", "城市", "是"],
            ["忽略", "替换", "关闭", "否"],
        ]
    )
    text, applied = apply_pronunciations("重庆银行位于重庆，忽略。", rules)

    assert text == "重 庆 银行位于重 庆，忽略。"
    assert applied == ["重庆银行", "重庆"]
    with pytest.raises(ProjectError, match="重复"):
        normalize_pronunciations([["林舟", "林 舟", "", "是"], ["林舟", "林周", "", "是"]])


def test_project_id_cannot_escape_store_root(tmp_path):
    store = NovelProjectStore(tmp_path / "projects", tmp_path / "voices")
    with pytest.raises(ProjectError, match="ID"):
        store.load("../outside")
