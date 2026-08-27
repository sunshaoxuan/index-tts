import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest

import voice_design_worker as worker
from novel_project import NovelProjectStore
import product_voice_worker
from product_voice_worker import prepare_voice_runtime, quarantine_cross_role_voices, resolve_or_reuse_guidance, verified_candidate_metrics
from text_director import guidance_role_signature


def prepare_model(model_dir: Path) -> None:
    (model_dir / "speech_tokenizer").mkdir(parents=True)
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / "model.safetensors").write_bytes(b"model")


def test_pitch_score_prefers_the_candidate_closest_to_user_target():
    assert worker.gender_pitch_score("male", 110.0, 105.0) > worker.gender_pitch_score("male", 150.0, 105.0)
    assert worker.gender_pitch_score("female", 225.0, 220.0) > worker.gender_pitch_score("female", 180.0, 220.0)


def test_pitch_score_prioritizes_a_gender_matched_candidate_before_target_distance():
    assert worker.gender_pitch_score("female", 180.0, 120.0) > worker.gender_pitch_score("female", 120.0, 120.0)
    assert worker.gender_pitch_score("male", 180.0, 220.0) > worker.gender_pitch_score("male", 220.0, 220.0)


def test_voice_design_runtime_release_drops_model_and_cuda_cache():
    calls = []

    class FakeCuda:
        @staticmethod
        def is_available():
            return True

        @staticmethod
        def empty_cache():
            calls.append("empty_cache")

        @staticmethod
        def ipc_collect():
            calls.append("ipc_collect")

    runtime = worker.VoiceDesignRuntime()
    runtime.model = object()
    runtime.model_dir = Path("voice-model")
    runtime.torch = type("FakeTorch", (), {"cuda": FakeCuda})

    assert runtime.release() is True
    assert runtime.model is None
    assert runtime.model_dir is None
    assert runtime.torch is None
    assert calls == ["empty_cache", "ipc_collect"]


def test_voice_runtime_releases_resident_render_model_before_start(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(product_voice_worker, "release_render_model", lambda root: calls.append(("release_render", root)))
    monkeypatch.setattr(product_voice_worker, "ensure_voice_design_daemon", lambda root, python: calls.append(("ensure_voice", root, python)) or {"pid": 123})
    voice_python = tmp_path / "voice-python.exe"
    assert prepare_voice_runtime(tmp_path, voice_python) == {"pid": 123}
    assert calls == [("release_render", tmp_path), ("ensure_voice", tmp_path, voice_python)]


def test_voice_design_worker_generates_each_role(tmp_path, monkeypatch):
    class FakeModel:
        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        def generate_voice_design(self, **kwargs):
            return [np.zeros(2400, dtype=np.float32)], 24000

    fake_qwen = types.ModuleType("qwen_tts")
    fake_qwen.Qwen3TTSModel = FakeModel
    monkeypatch.setitem(sys.modules, "qwen_tts", fake_qwen)
    input_path = tmp_path / "input.json"
    result_path = tmp_path / "result.json"
    status_path = tmp_path / "status.json"
    output_dir = tmp_path / "voices"
    prepare_model(tmp_path / "model")
    input_path.write_text(json.dumps({"jobs": [{"role_id": "narrator", "name": "旁白", "filename": "narrator.wav", "text": "测试", "language": "Chinese", "instruct": "稳定"}], "output_dir": str(output_dir), "model_dir": str(tmp_path / "model")}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["worker", "--input", str(input_path), "--result", str(result_path), "--status", str(status_path)])

    assert worker.main() == 0
    result = json.loads(result_path.read_text(encoding="utf-8"))
    assert result["generated"][0]["role_id"] == "narrator"
    assert (output_dir / "narrator.wav").is_file()
    assert json.loads(status_path.read_text(encoding="utf-8"))["phase"] == "complete"


def test_voice_design_worker_retries_a_male_pitch_candidate_for_a_female_role(tmp_path, monkeypatch):
    calls = []

    class FakeModel:
        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        def generate_voice_design(self, **kwargs):
            frequency = 90 if not calls else 210
            calls.append(frequency)
            timeline = np.arange(24000, dtype=np.float32) / 24000
            return [0.2 * np.sin(2 * np.pi * frequency * timeline)], 24000

    fake_qwen = types.ModuleType("qwen_tts")
    fake_qwen.Qwen3TTSModel = FakeModel
    monkeypatch.setitem(sys.modules, "qwen_tts", fake_qwen)
    input_path = tmp_path / "input.json"
    result_path = tmp_path / "result.json"
    status_path = tmp_path / "status.json"
    output_dir = tmp_path / "voices"
    prepare_model(tmp_path / "model")
    input_path.write_text(json.dumps({"jobs": [{"role_id": "role_002", "name": "老板娘", "filename": "owner.wav", "text": "测试", "language": "Chinese", "instruct": "中年女性音色", "expected_gender": "female", "voice_generation": {"candidate_count": 1}}], "output_dir": str(output_dir), "model_dir": str(tmp_path / "model"), "gender_max_attempts": 2}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["worker", "--input", str(input_path), "--result", str(result_path), "--status", str(status_path)])

    assert worker.main() == 0
    generated = json.loads(result_path.read_text(encoding="utf-8"))["generated"][0]
    assert calls == [90, 210]
    assert generated["expected_gender"] == "female"
    assert generated["median_pitch_hz"] >= 180
    assert generated["generation_attempts"] == 2
    assert all(Path(item["path"]).is_file() for item in generated["candidate_metrics"])


def test_voice_design_worker_evaluates_all_candidates_for_an_older_character(tmp_path, monkeypatch):
    frequencies = [108, 101, 96]
    calls = []

    class FakeModel:
        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        def generate_voice_design(self, **kwargs):
            frequency = frequencies[len(calls)]
            calls.append(frequency)
            timeline = np.arange(24000, dtype=np.float32) / 24000
            return [0.2 * np.sin(2 * np.pi * frequency * timeline)], 24000

    fake_qwen = types.ModuleType("qwen_tts")
    fake_qwen.Qwen3TTSModel = FakeModel
    monkeypatch.setitem(sys.modules, "qwen_tts", fake_qwen)
    model_dir = tmp_path / "model"
    prepare_model(model_dir)
    result = worker.generate_voice_design(
        {
            "jobs": [{
                "role_id": "role_003", "name": "教授", "filename": "professor.wav", "text": "测试",
                "language": "Chinese", "instruct": "成熟偏老年男性声线", "expected_gender": "male",
                "character_age": 55, "pitch_target_hz": 100, "voice_generation": {"candidate_count": 3},
            }],
            "output_dir": str(tmp_path / "voices"), "model_dir": str(model_dir), "gender_max_attempts": 3,
        },
        tmp_path / "result.json",
        tmp_path / "status.json",
    )

    generated = result["generated"][0]
    assert calls == frequencies
    assert generated["generation_attempts"] == 3
    assert len(generated["candidate_metrics"]) == 3
    assert sum(item["selected"] for item in generated["candidate_metrics"]) == 1
    assert generated["median_pitch_hz"] == generated["candidate_metrics"][1]["median_pitch_hz"]


def test_voice_design_runtime_reuses_one_loaded_model_for_later_requests(tmp_path, monkeypatch):
    load_count = 0

    class FakeModel:
        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            nonlocal load_count
            load_count += 1
            return cls()

        def generate_voice_design(self, **kwargs):
            return [np.zeros(2400, dtype=np.float32)], 24000

    fake_qwen = types.ModuleType("qwen_tts")
    fake_qwen.Qwen3TTSModel = FakeModel
    monkeypatch.setitem(sys.modules, "qwen_tts", fake_qwen)
    runtime = worker.VoiceDesignRuntime()
    model_dir = tmp_path / "model"
    prepare_model(model_dir)

    results = []
    for index in range(2):
        output_dir = tmp_path / f"voices-{index}"
        result_path = tmp_path / f"result-{index}.json"
        status_path = tmp_path / f"status-{index}.json"
        payload = {
            "jobs": [{"role_id": f"role_{index}", "name": f"角色{index}", "filename": f"role-{index}.wav", "text": "测试", "language": "Chinese", "instruct": "稳定"}],
            "output_dir": str(output_dir),
            "model_dir": str(model_dir),
        }
        results.append(worker.generate_voice_design(payload, result_path, status_path, runtime))

    assert load_count == 1
    assert results[0]["model_reused"] is False
    assert results[1]["model_reused"] is True
    assert results[0]["runtime_pid"] == results[1]["runtime_pid"]


def test_voice_design_worker_passes_per_role_native_sampling_parameters(tmp_path, monkeypatch):
    calls = []

    class FakeModel:
        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        def generate_voice_design(self, **kwargs):
            calls.append(kwargs)
            return [np.zeros(2400, dtype=np.float32)], 24000

    fake_qwen = types.ModuleType("qwen_tts")
    fake_qwen.Qwen3TTSModel = FakeModel
    monkeypatch.setitem(sys.modules, "qwen_tts", fake_qwen)
    model_dir = tmp_path / "model"
    prepare_model(model_dir)
    worker.generate_voice_design({
        "jobs": [{
            "role_id": "role_004", "name": "测试角色", "filename": "role.wav", "text": "角色专属试听文本", "language": "Chinese", "instruct": "结构化音色",
            "voice_generation": {"candidate_count": 1, "do_sample": True, "top_k": 88, "top_p": 0.77, "temperature": 1.2, "repetition_penalty": 1.11, "subtalker_dosample": True, "subtalker_top_k": 66, "subtalker_top_p": 0.72, "subtalker_temperature": 1.15, "max_new_tokens": 3072},
        }],
        "output_dir": str(tmp_path / "voices"), "model_dir": str(model_dir),
    }, tmp_path / "result.json", tmp_path / "status.json")
    assert len(calls) == 1
    assert calls[0]["text"] == "角色专属试听文本"
    assert calls[0]["top_k"] == 88
    assert calls[0]["subtalker_top_k"] == 66
    assert calls[0]["temperature"] == 1.2
    assert calls[0]["max_new_tokens"] == 3072


def test_voice_design_runtime_rejects_missing_model_files_before_import(tmp_path, monkeypatch):
    imported = []
    original_import = __import__

    def recording_import(name, *args, **kwargs):
        if name in {"torch", "qwen_tts"}:
            imported.append(name)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", recording_import)
    runtime = worker.VoiceDesignRuntime()

    try:
        runtime.get_model({"model_dir": str(tmp_path / "missing-model")}, tmp_path / "status.json")
    except FileNotFoundError as error:
        assert "模型文件不完整" in str(error)
    else:
        raise AssertionError("missing model files were accepted")
    assert imported == []


def test_gender_pitch_guard_rejects_obvious_cross_gender_pitch():
    assert not worker.gender_pitch_matches("female", 89.5)
    assert worker.gender_pitch_matches("female", 180.0)
    assert worker.gender_pitch_matches("male", 110.0)
    assert not worker.gender_pitch_matches("male", 230.0)
    assert worker.gender_pitch_matches("male", 255.0, 10)
    assert not worker.gender_pitch_matches("male", 255.0, 35)
    assert not worker.gender_pitch_matches("female", 174.77, 55, 210.0)
    assert not worker.gender_pitch_matches("female", 186.42, 35, 217.0)
    assert worker.gender_pitch_matches("female", 195.0, 35, 217.0)


def test_worker_collects_requested_number_of_verified_female_candidates(tmp_path, monkeypatch):
    frequencies = [110, 175, 193, 205, 218]
    calls = []

    class FakeModel:
        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        def generate_voice_design(self, **kwargs):
            frequency = frequencies[len(calls)]
            calls.append(frequency)
            timeline = np.arange(24000, dtype=np.float32) / 24000
            return [0.2 * np.sin(2 * np.pi * frequency * timeline)], 24000

    fake_qwen = types.ModuleType("qwen_tts")
    fake_qwen.Qwen3TTSModel = FakeModel
    monkeypatch.setitem(sys.modules, "qwen_tts", fake_qwen)
    model_dir = tmp_path / "model"
    prepare_model(model_dir)
    result = worker.generate_voice_design({
        "jobs": [{
            "role_id": "role_f", "name": "女性角色", "filename": "female.wav", "text": "测试",
            "language": "Chinese", "instruct": "明确女性声音", "expected_gender": "female",
            "character_age": 35, "pitch_target_hz": 217, "voice_generation": {"candidate_count": 3},
        }],
        "output_dir": str(tmp_path / "voices"), "model_dir": str(model_dir),
    }, tmp_path / "result.json", tmp_path / "status.json")

    generated = result["generated"][0]
    assert calls == frequencies
    assert generated["requested_candidate_count"] == 3
    assert generated["valid_candidate_count"] == 3
    assert generated["gender_verified"] is True
    assert [item["gender_matched"] for item in generated["candidate_metrics"]] == [False, False, True, True, True]


def test_product_registration_excludes_cross_gender_candidates():
    item = {
        "expected_gender": "female",
        "candidate_metrics": [
            {"seed": 42, "median_pitch_hz": 110.0, "gender_matched": False},
            {"seed": 43, "median_pitch_hz": 205.0, "gender_matched": True},
        ],
    }
    assert [metric["seed"] for metric in verified_candidate_metrics(item)] == [43]


def test_worker_rejects_a_partial_verified_candidate_set(tmp_path, monkeypatch):
    class FakeModel:
        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        def generate_voice_design(self, **kwargs):
            timeline = np.arange(24000, dtype=np.float32) / 24000
            return [0.2 * np.sin(2 * np.pi * 175 * timeline)], 24000

    fake_qwen = types.ModuleType("qwen_tts")
    fake_qwen.Qwen3TTSModel = FakeModel
    monkeypatch.setitem(sys.modules, "qwen_tts", fake_qwen)
    model_dir = tmp_path / "model"
    prepare_model(model_dir)
    with pytest.raises(ValueError, match="要求 2 个女性候选.*只有 0 个通过"):
        worker.generate_voice_design({
            "jobs": [{
                "role_id": "role_f", "name": "女性角色", "filename": "female.wav", "text": "测试",
                "language": "Chinese", "instruct": "明确女性声音", "expected_gender": "female",
                "character_age": 35, "pitch_target_hz": 217, "voice_generation": {"candidate_count": 2},
            }],
            "output_dir": str(tmp_path / "voices"), "model_dir": str(model_dir),
        }, tmp_path / "result.json", tmp_path / "status.json")


def test_cross_role_guidance_quarantines_a_registered_voice(tmp_path):
    store = NovelProjectStore(tmp_path / "projects", tmp_path / "voices")
    generated = tmp_path / "generated.wav"
    generated.write_bytes(b"RIFF")
    job = {"role_id": "role_002", "name": "老板娘", "language": "Chinese", "text": "测试", "instruct": "本角色有效导演上下文：旁白缓慢而深沉。人物小传：店主。声音导演：女性音色。"}
    metadata = store.register_voice(generated, job, model="voice-model")
    routing = {"assignments": [{"source_text": "旁白缓慢而深沉", "target_role_ids": ["narrator"]}]}

    assert quarantine_cross_role_voices(store, routing) == {metadata["voice_id"]}
    saved = json.loads((store.voice_library_root / f"{metadata['voice_id']}.json").read_text(encoding="utf-8"))
    assert saved["quarantined"] is True
    assert "其他轨道" in saved["quarantine_reason"]


def test_cross_role_guidance_does_not_quarantine_a_role_voice_with_the_same_words_in_its_own_voice_hint(tmp_path):
    store = NovelProjectStore(tmp_path / "projects", tmp_path / "voices")
    generated = tmp_path / "generated.wav"
    generated.write_bytes(b"RIFF")
    job = {
        "role_id": "role_003", "name": "松野教授", "language": "Chinese", "text": "测试",
        "instruct": "本角色有效导演上下文：遵循作品体裁。人物小传：法医学教授。声音导演：老年男性音色，语气冷静。",
        "effective_guidance_sources": [], "effective_guidance_instructions": [],
    }
    metadata = store.register_voice(generated, job, model="voice-model")
    routing = {"assignments": [{"source_text": "老年男性音色", "instruction": "老年男性音色", "target_role_ids": ["narrator"]}]}

    assert quarantine_cross_role_voices(store, routing, {metadata["voice_id"]}) == set()
    saved = json.loads((store.voice_library_root / f"{metadata['voice_id']}.json").read_text(encoding="utf-8"))
    assert "quarantined" not in saved


def test_cross_role_guidance_only_scans_voices_referenced_by_the_current_project(tmp_path):
    store = NovelProjectStore(tmp_path / "projects", tmp_path / "voices")
    generated = tmp_path / "generated.wav"
    generated.write_bytes(b"RIFF")
    active = store.register_voice(generated, {"role_id": "role_001", "name": "当前角色", "language": "Chinese", "text": "甲", "instruct": "本角色有效导演上下文：正常。人物小传：当前。"}, model="voice-model")
    unrelated = store.register_voice(generated, {"role_id": "role_002", "name": "其他工程角色", "language": "Chinese", "text": "乙", "instruct": "本角色有效导演上下文：旁白低沉。人物小传：其他。"}, model="voice-model")
    routing = {"assignments": [{"source_text": "旁白低沉", "target_role_ids": ["narrator"]}]}

    assert quarantine_cross_role_voices(store, routing, {active["voice_id"]}) == set()
    saved = json.loads((store.voice_library_root / f"{unrelated['voice_id']}.json").read_text(encoding="utf-8"))
    assert "quarantined" not in saved


def test_voice_job_reuses_current_guidance_routing_without_calling_ollama():
    roles = [["narrator", "旁白", "narrator", "叙事", "成熟声线", "voice-1", "自然叙述", "是"]]
    routing = {
        "guidance": "旁白低沉",
        "model": "qwen3:8b",
        "role_signature": guidance_role_signature(roles),
        "assignments": [{"source_text": "旁白低沉", "target_role_ids": ["narrator"]}],
    }

    class FailingDirector:
        config = type("Config", (), {"model": "qwen3:8b"})()

        @staticmethod
        def resolve_guidance(*_args):
            raise AssertionError("unchanged guidance routing called Ollama")

    resolved, reused = resolve_or_reuse_guidance(
        {"guidance": "旁白低沉", "roles": roles, "document": {"guidance_routing": routing}},
        FailingDirector(),
    )

    assert reused is True
    assert resolved is routing


def test_voice_job_refreshes_guidance_routing_after_a_role_change():
    old_roles = [["narrator", "旁白", "narrator", "叙事", "成熟声线", "voice-1", "自然叙述", "是"]]
    new_roles = [["narrator", "旁白", "narrator", "叙事", "苍老声线", "voice-1", "自然叙述", "是"]]
    routing = {
        "guidance": "旁白低沉",
        "model": "qwen3:8b",
        "role_signature": guidance_role_signature(old_roles),
        "assignments": [],
    }
    refreshed = {**routing, "role_signature": guidance_role_signature(new_roles)}

    class RecordingDirector:
        config = type("Config", (), {"model": "qwen3:8b"})()
        calls = 0

        @classmethod
        def resolve_guidance(cls, *_args):
            cls.calls += 1
            return refreshed

    resolved, reused = resolve_or_reuse_guidance(
        {"guidance": "旁白低沉", "roles": new_roles, "document": {"guidance_routing": routing}},
        RecordingDirector(),
    )

    assert reused is False
    assert resolved is refreshed
    assert RecordingDirector.calls == 1
