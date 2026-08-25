import json
import threading
import wave
import zipfile
from pathlib import Path

import pytest

from text_director import (
    DIRECTOR_SCHEMA,
    DirectorConfig,
    DirectorCancelled,
    DirectorError,
    DirectorTimeout,
    DirectorValidationError,
    OllamaTextDirector,
    ROLE_HEADERS,
    RHYTHM_PRESETS,
    SEGMENT_HEADERS,
    VOICE_STYLE_PRESETS,
    concatenate_wav_segments,
    apply_generated_voices,
    build_voice_design_jobs,
    coverage_key,
    document_to_tables,
    migrate_attitude_preset,
    migrate_emotion_label,
    migrate_pace_preset,
    migrate_rhythm_preset,
    render_directed_audio,
    is_speech_attribution,
    split_document,
    split_exact_sentences,
    tables_to_script,
)


def _character(role_id="narrator", name="旁白", kind="narrator"):
    return {
        "id": role_id,
        "name": name,
        "kind": kind,
        "profile": "测试角色",
        "voice_hint": "稳定自然",
    }


def _segment(order, source_text, text, role_id="narrator", name="旁白", kind="narrator"):
    return {
        "order": order,
        "section": "第一段",
        "speaker_id": role_id,
        "speaker_name": name,
        "speaker_kind": kind,
        "language": "ZH",
        "source_text": source_text,
        "text": text,
        "attitude": "平静叙述",
        "emotion": "calm",
        "intensity": 0.6,
        "pace": "medium",
        "pause_after_ms": 300,
    }


class FakeDirector(OllamaTextDirector):
    def __init__(self, responses):
        super().__init__(DirectorConfig(model="fake", max_chunk_chars=1000))
        self.responses = list(responses)
        self.prompts = []

    def _chat(self, prompt):
        self.prompts.append(prompt)
        return self.responses.pop(0), {"prompt_tokens": 10, "output_tokens": 20, "duration_seconds": 0.1}


def _valid_response():
    return {
        "content_type": "novel",
        "title": "雨夜",
        "characters": [
            _character(),
            _character("local-li", "李明", "character"),
        ],
        "segments": [
            _segment(1, "雨夜。", "雨夜。"),
            _segment(2, "李明说：", "李明说：", "local-li", "李明", "character"),
            _segment(3, "“你终于来了。”", "你终于来了。", "local-li", "李明", "character"),
        ],
    }


def _write_wav(path: Path, frame_count=2205):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(22050)
        output.writeframes(b"\x01\x00" * frame_count)


def _role_row(role_id="narrator", name="旁白", kind="narrator", voice_id="voice_05.wav", rhythm="沉稳舒缓"):
    return [role_id, name, kind, "测试角色", "中性清晰", voice_id, rhythm, "否"]


def test_schema_requires_lossless_source_and_directing_fields():
    required = set(DIRECTOR_SCHEMA["properties"]["segments"]["items"]["required"])
    assert {
        "source_text",
        "text",
        "speaker_id",
        "speaker_kind",
        "attitude",
        "emotion",
        "intensity",
        "pace",
        "pause_after_ms",
    } <= required


def test_split_document_preserves_every_non_whitespace_character():
    source = "第一章\n\n" + "很久以前。" * 60 + "\n第二章\n" + "故事继续！" * 60
    chunks = split_document(source, max_chars=120)
    assert len(chunks) > 2
    assert coverage_key("".join(chunks)) == coverage_key(source)
    assert all(len(chunk) <= 120 for chunk in chunks)


def test_ai_analysis_preserves_attribution_and_builds_stable_tracks():
    source = "雨夜。李明说：“你终于来了。”"
    director = FakeDirector([_valid_response()])
    result = director.analyze_document(source, content_type="novel")

    assert result["content_type"] == "novel"
    assert result["characters"][0]["id"] == "narrator"
    assert result["characters"][1]["id"] == "role_001"
    assert [segment["speaker_id"] for segment in result["segments"]] == ["narrator", "narrator", "role_001"]
    assert coverage_key("".join(segment["source_text"] for segment in result["segments"])) == coverage_key(source)
    assert "说话归属文字" in director.prompts[0]


def test_narrator_aliases_merge_into_one_stable_track():
    response = _valid_response()
    response["characters"][0]["name"] = "narrator"
    response["segments"][0]["speaker_name"] = "Narrator"
    director = FakeDirector([response])

    result = director.analyze_document("雨夜。李明说：“你终于来了。”", content_type="novel")

    narrators = [item for item in result["characters"] if item["kind"] == "narrator"]
    assert narrators == [{"id": "narrator", "name": "旁白", "kind": "narrator", "profile": "测试角色", "voice_hint": "稳定自然"}]
    assert all(item["speaker_name"] == "旁白" for item in result["segments"] if item["speaker_kind"] == "narrator")


def test_ai_analysis_retries_once_after_coverage_failure():
    invalid = _valid_response()
    invalid["segments"] = [invalid["segments"][1]]
    director = FakeDirector([invalid, _valid_response()])

    result = director.analyze_document("雨夜。李明说：“你终于来了。”", content_type="novel")

    assert len(director.prompts) == 2
    assert "校验错误" in director.prompts[1]
    assert len(result["segments"]) == 3


def test_ai_analysis_restores_curly_quotes_and_splits_embedded_dialogue():
    source = "雨夜。李明说：“你来了。”\n门外传来孩子的喊声：“快走！”"
    response = {
        "content_type": "novel",
        "title": "雨夜",
        "characters": [
            _character(),
            _character("li", "李明", "character"),
        ],
        "segments": [
            _segment(1, "雨夜。", "雨夜。"),
            _segment(2, '李明说："你来了。"', "李明说：你来了。", "li", "李明", "character"),
            _segment(3, '门外传来孩子的喊声："快走！"', "门外传来孩子的喊声：快走！"),
        ],
    }
    director = FakeDirector([response])

    result = director.analyze_document(source, content_type="novel")

    assert len(director.prompts) == 1
    assert coverage_key("".join(segment["source_text"] for segment in result["segments"])) == coverage_key(source)
    assert [segment["speaker_name"] for segment in result["segments"]] == ["旁白", "旁白", "李明", "旁白", "孩子"]
    assert result["segments"][2]["source_text"] == "“你来了。”"
    assert result["segments"][2]["text"] == "你来了。"


def test_ai_analysis_falls_back_after_two_incomplete_results():
    invalid = _valid_response()
    invalid["segments"] = [invalid["segments"][1]]
    director = FakeDirector([invalid, invalid])

    source = "雨夜。李明说：“你终于来了。”"
    result = director.analyze_document(source)

    assert result["metrics"]["fallback_chunks"] == 1
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)


def test_timeout_is_not_repeated_for_the_same_large_chunk():
    class TimeoutDirector(OllamaTextDirector):
        calls = 0

        def _chat(self, prompt):
            self.calls += 1
            raise DirectorTimeout("测试超时")

    director = TimeoutDirector(DirectorConfig(model="fake"))
    with pytest.raises(DirectorTimeout, match="测试超时"):
        director._analyze_chunk(
            chunk="长文本。" * 100,
            chunk_index=1,
            chunk_count=1,
            requested_type="story",
            existing_characters=[],
            previous_context="",
            guidance="",
        )

    assert director.calls == 1


def test_long_document_adaptively_splits_timed_out_chunks():
    class AdaptiveDirector(OllamaTextDirector):
        attempted_lengths = []

        def _analyze_chunk(self, *, chunk, **kwargs):
            self.attempted_lengths.append(len(chunk))
            if len(chunk) > 700:
                raise DirectorTimeout("块过大")
            return (
                {
                    "content_type": "story",
                    "title": "长篇测试",
                    "characters": [_character()],
                    "segments": [_segment(1, chunk, chunk)],
                },
                {"prompt_tokens": 10, "output_tokens": 20, "duration_seconds": 0.1},
            )

    source = "很久以前，故事仍在继续。" * 180
    director = AdaptiveDirector(DirectorConfig(model="fake", max_chunk_chars=1400))
    progress_messages = []
    result = director.analyze_document(
        source,
        content_type="story",
        progress=lambda fraction, desc="": progress_messages.append(desc),
    )

    assert any(length > 700 for length in director.attempted_lengths)
    assert result["metrics"]["chunks"] >= 4
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)
    assert any("超时" in message and "拆" in message for message in progress_messages)


def test_long_document_adaptively_splits_coverage_failures():
    class CoverageDirector(OllamaTextDirector):
        attempted_lengths = []

        def _analyze_chunk(self, *, chunk, **kwargs):
            self.attempted_lengths.append(len(chunk))
            if len(chunk) > 320:
                raise DirectorValidationError("source_text 未完整覆盖本次原文")
            return (
                {
                    "content_type": "novel",
                    "title": "覆盖测试",
                    "characters": [_character()],
                    "segments": [_segment(1, chunk, chunk)],
                },
                {"prompt_tokens": 5, "output_tokens": 10, "duration_seconds": 0.05},
            )

    source = "林舟沿着长街继续前行，仔细记下沿途的每一个细节。" * 100
    director = CoverageDirector(DirectorConfig(model="fake", max_chunk_chars=1400))
    progress_messages = []
    result = director.analyze_document(
        source,
        content_type="novel",
        progress=lambda fraction, desc="": progress_messages.append(desc),
    )

    assert max(director.attempted_lengths) > 320
    assert result["metrics"]["chunks"] > 4
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)
    assert any("覆盖校验失败" in message and "拆" in message for message in progress_messages)


def test_real_validation_retry_chain_subdivides_until_coverage_passes():
    class ValidationChainDirector(OllamaTextDirector):
        attempted_lengths = []

        def _chat(self, prompt):
            chunk = prompt.split("<<<SOURCE\n", 1)[1].split("\nSOURCE", 1)[0]
            self.attempted_lengths.append(len(chunk))
            returned = chunk if len(chunk) <= 320 else chunk[:-1]
            return (
                {
                    "content_type": "story",
                    "title": "自动细分",
                    "characters": [_character()],
                    "segments": [_segment(1, returned, returned)],
                },
                {"prompt_tokens": 5, "output_tokens": 10, "duration_seconds": 0.05},
            )

    source = "港口的灯光沿着海面缓慢移动，林舟认真核对航海日志。" * 40
    director = ValidationChainDirector(DirectorConfig(model="fake", max_chunk_chars=1400))
    result = director.analyze_document(source, content_type="story")

    large_lengths = [length for length in director.attempted_lengths if length > 320]
    assert large_lengths
    assert all(director.attempted_lengths.count(length) >= 2 for length in set(large_lengths))
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)


def test_exact_sentence_slices_preserve_quotes_whitespace_and_newlines():
    source = "第一句。\n\n林舟问：“现在走吗？”  最后一行没有句号"
    slices = split_exact_sentences(source)

    assert "".join(slices) == source
    assert len(slices) == 3


def test_minimum_failed_chunk_uses_lossless_fallback_and_continues():
    class AlwaysInvalidDirector(OllamaTextDirector):
        def _analyze_chunk(self, **kwargs):
            raise DirectorValidationError("source_text 未完整覆盖本次原文")

    source = "雨停了。林舟说：“我们继续走。”\n下一段仍然完整保留。"
    messages = []
    director = AlwaysInvalidDirector(DirectorConfig(model="fake", max_chunk_chars=1400))
    result = director.analyze_document(
        source,
        content_type="story",
        progress=lambda fraction, desc="": messages.append(desc),
    )

    assert result["metrics"]["fallback_chunks"] == 1
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)
    assert any("无损安全分段" in message for message in messages)
    assert any(character["name"] == "林舟" for character in result["characters"])


def test_tables_round_trip_role_voice_and_segment_annotations():
    document = {
        "characters": [_character(), _character("role_001", "李明", "character")],
        "segments": [
            _segment(1, "雨夜。", "雨夜。"),
            _segment(2, "你好。", "你好。", "role_001", "李明", "character"),
        ],
    }
    role_rows, segment_rows = document_to_tables(document, ["voice_01.wav", "voice_05.wav"])
    roles, segments = tables_to_script(role_rows, segment_rows)

    assert len(ROLE_HEADERS) == len(role_rows[0])
    assert len(SEGMENT_HEADERS) == len(segment_rows[0])
    assert roles["narrator"]["voice_id"] == "voice_05.wav"
    assert "停连" in roles["narrator"]["rhythm_prompt"]
    assert segments[1]["speaker_id"] == "role_001"
    assert segments[1]["attitude_preset"] == "中性叙述"
    assert segments[1]["emotion_label"] == "平静"


def test_legacy_natural_language_directing_values_migrate_to_presets():
    assert migrate_rhythm_preset("沉稳从容，韵母自然舒展，停连清晰") == "沉稳舒缓"
    assert migrate_rhythm_preset("轻快灵动，短句间自然换气") == "轻快活泼"
    assert migrate_pace_preset("短语间停连清晰，整体舒缓") == "舒缓"
    assert migrate_attitude_preset("平静叙述") == "中性叙述"
    assert migrate_emotion_label("melancholic") == "低落"


def test_unknown_limited_presets_are_rejected_but_voice_design_accepts_native_prompt():
    document = {
        "characters": [_character()],
        "segments": [_segment(1, "测试。", "测试。")],
    }
    role_rows = [["narrator", "旁白", "narrator", "成熟", "五十岁女声，略带沙哑", "voice_05.wav", "自然叙述", "是"]]
    jobs = build_voice_design_jobs(document, role_rows, {"content_type": "story", "guidance": "悬疑故事，人物对白克制"})
    assert "五十岁女声，略带沙哑" in jobs[0]["instruct"]
    assert "作品体裁：故事体" in jobs[0]["instruct"]
    assert "全局导演上下文：悬疑故事，人物对白克制；只采用其中与当前角色直接相关的要求" in jobs[0]["instruct"]
    assert "人物小传：成熟" in jobs[0]["instruct"]
    assert "声音导演：五十岁女声，略带沙哑" in jobs[0]["instruct"]
    assert jobs[0]["instruct"].startswith("为旁白设计")
    assert "旁白旁白" not in jobs[0]["instruct"]

    invalid_roles = [list(role_rows[0])]
    invalid_roles[0][6] = "随便慢一点"
    segment_rows = [[1, "正文", "narrator", "旁白", "ZH", "测试。", "测试。", "中性叙述", "平静", 0.5, "自然", 0]]
    with pytest.raises(DirectorError, match="未知角色节奏预设"):
        tables_to_script(invalid_roles, segment_rows)

    for index, value, message in ((7, "自行发挥", "未知态度预设"), (8, "惆怅", "未知情绪预设"), (10, "拖慢", "未知句内节奏预设")):
        invalid_segments = [list(segment_rows[0])]
        invalid_segments[0][index] = value
        with pytest.raises(DirectorError, match=message):
            tables_to_script(role_rows, invalid_segments)


def test_director_prompt_requires_evidence_grounded_biography_and_voice_direction():
    director = OllamaTextDirector(DirectorConfig())
    prompt = director._build_prompt(
        chunk="笹垣是负责案件调查的刑警。",
        chunk_index=1,
        chunk_count=1,
        requested_type="novel",
        existing_characters=[],
        previous_context="",
        guidance="旁白克制",
    )
    assert "profile 是人物小传" in prompt
    assert "身份、年龄阶段、人物关系、性格、经历和叙事作用" in prompt
    assert "只写原文有依据的信息" in prompt
    assert "禁止只复制姓名" in prompt
    assert "voice_hint 是声音导演建议" in prompt
    assert "音高、共鸣位置、气息、吐字方式和基础情绪" in prompt
    assert "根据角色内容选择" in prompt


def test_quoted_speaker_inference_does_not_treat_low_voice_as_a_name():
    assert OllamaTextDirector._infer_quoted_speaker("林澈握紧信封，低声说：") == "林澈"
    assert OllamaTextDirector._infer_quoted_speaker("中冢抬起头，冷冷地问：") == "中冢"


def test_role_voice_matching_prefers_semantic_chinese_voices():
    document = {
        "characters": [
            _character(),
            {**_character("child", "小雨", "character"), "profile": "活泼的孩子"},
            {**_character("cold", "老周", "character"), "profile": "低沉沧桑，悲伤克制"},
        ],
        "segments": [],
    }
    rows, _ = document_to_tables(document, ["voice_01.wav", "voice_02.wav", "voice_05.wav", "voice_09.wav", "voice_11.wav"])

    assert rows[0][5] == "voice_05.wav"
    assert rows[1][5] == "voice_09.wav"
    assert rows[2][5] == "voice_11.wav"
    assert all(row[5] not in {"voice_01.wav", "voice_02.wav"} for row in rows)
    assert len({row[6] for row in rows}) > 1


def test_voice_design_jobs_and_generated_voice_mapping(tmp_path):
    document = {
        "characters": [_character(), _character("role_001", "李 明", "character")],
        "segments": [_segment(1, "你好。", "你好。", "role_001", "李 明", "character")],
    }
    roles = [
        ["narrator", "旁白", "narrator", "成熟稳重", "厚实沉稳", "voice_05.wav", "沉稳舒缓", "是"],
        ["role_001", "李 明", "character", "年轻明亮", "清澈明亮", "voice_09.wav", "轻快活泼", "是"],
    ]
    jobs = build_voice_design_jobs(document, roles)
    generated_path = tmp_path / jobs[1]["filename"]
    generated_path.touch()
    updated = apply_generated_voices(roles, [{"role_id": "role_001", "path": str(generated_path)}])

    assert jobs[0]["language"] == "Chinese"
    assert "旁白" in jobs[0]["instruct"]
    assert jobs[1]["filename"].endswith(".wav")
    assert " " not in jobs[1]["filename"]
    assert updated[1][5] == generated_path.name
    assert updated[1][7] == "否"


def test_concat_writes_silence_between_wav_segments(tmp_path):
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    output = tmp_path / "joined.wav"
    _write_wav(first, 2205)
    _write_wav(second, 2205)

    concatenate_wav_segments(
        [
            {"audio_path": first, "pause_after_ms": 100},
            {"audio_path": second, "pause_after_ms": 0},
        ],
        output,
    )

    with wave.open(str(output), "rb") as joined:
        assert joined.getnframes() == 2205 + 2205 + 2205


def test_render_builds_master_role_tracks_manifest_csv_and_zip(tmp_path):
    demo_dir = tmp_path / "voices"
    _write_wav(demo_dir / "voice_01.wav", 100)
    _write_wav(demo_dir / "voice_05.wav", 100)
    output_root = tmp_path / "outputs"

    class FakeModel:
        calls = []

        def infer(self, **kwargs):
            self.calls.append(kwargs)
            _write_wav(Path(kwargs["output_path"]), 2205)
            return kwargs["output_path"]

    role_rows = [
        _role_row(),
        _role_row("role_001", "李明", "character", "voice_01.wav", "克制停连"),
    ]
    segment_rows = [
        [1, "开场", "narrator", "旁白", "ZH", "雨夜。", "雨夜。", "克制低沉", "平静", 0.5, "舒缓", 200],
        [2, "开场", "role_001", "李明", "ZH", "你好。", "你好。", "紧张警觉", "恐惧", 0.7, "紧凑", 300],
    ]
    model = FakeModel()
    master, package, manifest, status = render_directed_audio(
        document={"title": "雨夜", "content_type": "novel", "provider": "ollama", "model": "qwen3:14b"},
        role_table=role_rows,
        segment_table=segment_rows,
        uploaded_files=None,
        model=model,
        model_lock=threading.Lock(),
        output_root=output_root,
        demo_dir=demo_dir,
        demo_voices={"voice_01.wav": "一号", "voice_05.wav": "五号"},
    )

    assert Path(master).is_file()
    assert Path(package).is_file()
    assert Path(manifest).is_file()
    assert len(list((Path(master).parent / "segments").glob("*.wav"))) == 2
    assert len(list((Path(master).parent / "tracks").glob("*.wav"))) == 2
    assert len(list((Path(master).parent / "chapters").glob("*.wav"))) == 1
    assert (Path(master).parent / "director-script.csv").is_file()
    assert "2 条分句" in status
    assert "2 个角色配置、2 个有内容的角色轨道" in status
    assert model.calls[0]["emo_text"].endswith("克制、低沉地表达。平静。")
    assert "韵母自然舒展" in model.calls[0]["emo_text"]
    assert model.calls[0]["duration_factor"] == 1.0
    assert "沉稳舒缓" in model.calls[0]["emo_text"]
    with zipfile.ZipFile(package) as archive:
        names = set(archive.namelist())
        assert "full-audio.wav" in names
        assert "director-manifest.json" in names
        assert "director-script.csv" in names
        assert any(name.startswith("chapters/") for name in names)
    payload = json.loads(Path(manifest).read_text(encoding="utf-8"))
    assert payload["roles"][0]["voice_id"] == "voice_05.wav"


def test_render_cancel_stops_before_inference_and_cleans_run_directory(tmp_path):
    demo_dir = tmp_path / "voices"
    _write_wav(demo_dir / "voice_05.wav", 100)
    output_root = tmp_path / "outputs"
    cancelled = threading.Event()
    cancelled.set()

    class UnexpectedModel:
        def infer(self, **kwargs):
            raise AssertionError("inference should not start after cancellation")

    with pytest.raises(DirectorCancelled):
        render_directed_audio(
            document={"title": "取消测试", "content_type": "story"},
            role_table=[_role_row()],
            segment_table=[[1, "正文", "narrator", "旁白", "ZH", "测试。", "测试。", "中性叙述", "平静", 0.5, "自然", 0]],
            uploaded_files=None,
            model=UnexpectedModel(),
            model_lock=threading.Lock(),
            output_root=output_root,
            demo_dir=demo_dir,
            demo_voices={"voice_05.wav": "五号"},
            cancel_event=cancelled,
        )

    assert not list(output_root.glob("*"))


def test_render_applies_project_pronunciations_natural_rhythm_and_reuses_cache(tmp_path):
    demo_dir = tmp_path / "voices"
    _write_wav(demo_dir / "voice_05.wav", 100)
    output_root = tmp_path / "outputs"
    process_root = tmp_path / "process"

    class FakeModel:
        def __init__(self):
            self.calls = []

        def infer(self, **kwargs):
            self.calls.append(kwargs)
            _write_wav(Path(kwargs["output_path"]), 100)
            return kwargs["output_path"]

    role_rows = [_role_row(rhythm="沉稳舒缓")]
    segment_rows = [[1, "第一章", "narrator", "旁白", "ZH", "重庆银行。", "重庆银行。", "中性叙述", "平静", 0.5, "舒缓", 100]]
    pronunciations = [["重庆银行", "重 庆 银行", "固定专名读法", "是"]]
    first_model = FakeModel()
    first = render_directed_audio(
        document={"title": "纠音缓存", "content_type": "novel"},
        role_table=role_rows,
        segment_table=segment_rows,
        pronunciation_table=pronunciations,
        uploaded_files=None,
        model=first_model,
        model_lock=threading.Lock(),
        output_root=output_root,
        project_process_dir=process_root,
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
    )

    assert first_model.calls[0]["text"] == "重 庆 银行。"
    assert first_model.calls[0]["duration_factor"] == 1.0
    assert "韵母自然舒展" in first_model.calls[0]["emo_text"]
    assert "短语间停连清晰" in first_model.calls[0]["emo_text"]
    first_manifest = json.loads(Path(first[2]).read_text(encoding="utf-8"))
    assert first_manifest["segments"][0]["effective_text"] == "重 庆 银行。"
    assert first_manifest["segments"][0]["text"] == "重庆银行。"

    second_model = FakeModel()
    second = render_directed_audio(
        document={"title": "纠音缓存", "content_type": "novel"},
        role_table=role_rows,
        segment_table=segment_rows,
        pronunciation_table=pronunciations,
        uploaded_files=None,
        model=second_model,
        model_lock=threading.Lock(),
        output_root=output_root,
        project_process_dir=process_root,
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
    )
    second_manifest = json.loads(Path(second[2]).read_text(encoding="utf-8"))
    assert second_model.calls == []
    assert second_manifest["reused_segments"] == 1


def test_tables_reject_unknown_role_reference():
    role_rows = [_role_row()]
    segment_rows = [[1, "正文", "missing", "人物", "ZH", "原文", "原文", "中性叙述", "平静", 0.5, "自然", 300]]

    with pytest.raises(DirectorError, match="未知轨道"):
        tables_to_script(role_rows, segment_rows)


@pytest.mark.parametrize("text", ["李明说：", "她冷冷回应：", "记者问道:"])
def test_independent_speech_attribution_is_narrator_text(text):
    assert is_speech_attribution(text)


def test_spoken_sentence_with_reporting_verb_is_not_reclassified():
    assert not is_speech_attribution("他说今天会下雨。")
