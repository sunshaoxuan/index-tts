import json
import sys
import types

import numpy as np

import voice_design_worker as worker
from novel_project import NovelProjectStore
from product_voice_worker import quarantine_cross_role_voices, resolve_or_reuse_guidance
from text_director import guidance_role_signature


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
    input_path.write_text(json.dumps({"jobs": [{"role_id": "role_002", "name": "老板娘", "filename": "owner.wav", "text": "测试", "language": "Chinese", "instruct": "中年女性音色", "expected_gender": "female"}], "output_dir": str(output_dir), "model_dir": str(tmp_path / "model")}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["worker", "--input", str(input_path), "--result", str(result_path), "--status", str(status_path)])

    assert worker.main() == 0
    generated = json.loads(result_path.read_text(encoding="utf-8"))["generated"][0]
    assert calls == [90, 210]
    assert generated["expected_gender"] == "female"
    assert generated["median_pitch_hz"] >= 135
    assert generated["generation_attempts"] == 2


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


def test_gender_pitch_guard_rejects_obvious_cross_gender_pitch():
    assert not worker.gender_pitch_matches("female", 89.5)
    assert worker.gender_pitch_matches("female", 180.0)
    assert worker.gender_pitch_matches("male", 110.0)
    assert not worker.gender_pitch_matches("male", 230.0)


def test_cross_role_guidance_quarantines_a_registered_voice(tmp_path):
    store = NovelProjectStore(tmp_path / "projects", tmp_path / "voices")
    generated = tmp_path / "generated.wav"
    generated.write_bytes(b"RIFF")
    job = {"role_id": "role_002", "name": "老板娘", "language": "Chinese", "text": "测试", "instruct": "本角色上下文：旁白缓慢而深沉。女性音色。"}
    metadata = store.register_voice(generated, job, model="voice-model")
    routing = {"assignments": [{"source_text": "旁白缓慢而深沉", "target_role_ids": ["narrator"]}]}

    assert quarantine_cross_role_voices(store, routing) == {metadata["voice_id"]}
    saved = json.loads((store.voice_library_root / f"{metadata['voice_id']}.json").read_text(encoding="utf-8"))
    assert saved["quarantined"] is True
    assert "其他轨道" in saved["quarantine_reason"]


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
