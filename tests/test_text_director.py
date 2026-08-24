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
    OllamaTextDirector,
    ROLE_HEADERS,
    SEGMENT_HEADERS,
    concatenate_wav_segments,
    apply_generated_voices,
    build_voice_design_jobs,
    coverage_key,
    document_to_tables,
    render_directed_audio,
    is_speech_attribution,
    split_document,
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


def test_ai_analysis_rejects_two_incomplete_results():
    invalid = _valid_response()
    invalid["segments"] = [invalid["segments"][1]]
    director = FakeDirector([invalid, invalid])

    with pytest.raises(DirectorError, match="连续两次"):
        director.analyze_document("雨夜。李明说：“你终于来了。”")


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
    assert segments[1]["speaker_id"] == "role_001"
    assert segments[1]["attitude"] == "平静叙述"


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

    assert rows[0][4] == "voice_05.wav"
    assert rows[1][4] == "voice_09.wav"
    assert rows[2][4] == "voice_11.wav"
    assert all(row[4] not in {"voice_01.wav", "voice_02.wav"} for row in rows)


def test_voice_design_jobs_and_generated_voice_mapping(tmp_path):
    document = {
        "characters": [_character(), _character("role_001", "李 明", "character")],
        "segments": [_segment(1, "你好。", "你好。", "role_001", "李 明", "character")],
    }
    roles = [
        ["narrator", "旁白", "narrator", "成熟稳重", "voice_05.wav"],
        ["role_001", "李 明", "character", "年轻明亮", "voice_09.wav"],
    ]
    jobs = build_voice_design_jobs(document, roles)
    generated_path = tmp_path / jobs[1]["filename"]
    generated_path.touch()
    updated = apply_generated_voices(roles, [{"role_id": "role_001", "path": str(generated_path)}])

    assert jobs[0]["language"] == "Chinese"
    assert "旁白" in jobs[0]["instruct"]
    assert jobs[1]["filename"].endswith(".wav")
    assert " " not in jobs[1]["filename"]
    assert updated[1][4] == generated_path.name


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
        ["narrator", "旁白", "narrator", "稳定", "voice_05.wav"],
        ["role_001", "李明", "character", "克制", "voice_01.wav"],
    ]
    segment_rows = [
        [1, "开场", "narrator", "旁白", "ZH", "雨夜。", "雨夜。", "低沉叙述", "calm", 0.5, "slow", 200],
        [2, "开场", "role_001", "李明", "ZH", "你好。", "你好。", "克制警惕", "afraid", 0.7, "fast", 300],
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
    assert (Path(master).parent / "director-script.csv").is_file()
    assert "2 条分句" in status
    assert model.calls[0]["emo_text"] == "低沉叙述。平静。"
    assert model.calls[0]["duration_factor"] == 1.15
    with zipfile.ZipFile(package) as archive:
        names = set(archive.namelist())
        assert "full-audio.wav" in names
        assert "director-manifest.json" in names
        assert "director-script.csv" in names
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
            role_table=[["narrator", "旁白", "narrator", "稳定", "voice_05.wav"]],
            segment_table=[[1, "正文", "narrator", "旁白", "ZH", "测试。", "测试。", "平静", "calm", 0.5, "medium", 0]],
            uploaded_files=None,
            model=UnexpectedModel(),
            model_lock=threading.Lock(),
            output_root=output_root,
            demo_dir=demo_dir,
            demo_voices={"voice_05.wav": "五号"},
            cancel_event=cancelled,
        )

    assert not list(output_root.glob("*"))


def test_tables_reject_unknown_role_reference():
    role_rows = [["narrator", "旁白", "narrator", "", "voice_05.wav"]]
    segment_rows = [[1, "正文", "missing", "人物", "ZH", "原文", "原文", "平静", "calm", 0.5, "medium", 300]]

    with pytest.raises(DirectorError, match="未知轨道"):
        tables_to_script(role_rows, segment_rows)


@pytest.mark.parametrize("text", ["李明说：", "她冷冷回应：", "记者问道:"])
def test_independent_speech_attribution_is_narrator_text(text):
    assert is_speech_attribution(text)


def test_spoken_sentence_with_reporting_verb_is_not_reclassified():
    assert not is_speech_attribution("他说今天会下雨。")
