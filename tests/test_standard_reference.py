import json
import threading
import wave
from pathlib import Path

import numpy as np

import product_render_worker as render_worker
from novel_project import NovelProjectStore
from standard_reference import (
    ECHO_SIMILARITY_THRESHOLD,
    cleanup_unreferenced_standard_voices,
    delayed_echo_similarity,
    register_standard_voice,
    standard_reference_score,
)


def write_noise_wav(path: Path, seed: int, seconds: float = 1.5) -> None:
    rng = np.random.default_rng(seed)
    samples = np.clip(rng.normal(0, 0.12, int(24000 * seconds)), -0.8, 0.8)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes((samples * 32767).astype("<i2").tobytes())


def test_delayed_echo_similarity_distinguishes_repeated_audio(tmp_path):
    clean = tmp_path / "clean.wav"
    repeated = tmp_path / "repeated.wav"
    write_noise_wav(clean, 7)
    rng = np.random.default_rng(11)
    block = rng.normal(0, 0.12, 2400)
    samples = np.tile(block, 15)
    with wave.open(str(repeated), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes((samples * 32767).astype("<i2").tobytes())

    assert delayed_echo_similarity(clean) < ECHO_SIMILARITY_THRESHOLD
    assert delayed_echo_similarity(repeated) > ECHO_SIMILARITY_THRESHOLD


def test_standard_reference_score_rewards_zero_echo_similarity():
    perfect = standard_reference_score({"score": 20, "speaker_similarity": 0.8, "echo_similarity": 0})
    echoed = standard_reference_score({"score": 20, "speaker_similarity": 0.8, "echo_similarity": 1})

    assert perfect == 100
    assert echoed == 75


def test_standard_voice_cleanup_preserves_project_references(tmp_path):
    project_root = tmp_path / "projects"
    voice_library = tmp_path / "voices"
    project_root.mkdir()
    voice_library.mkdir()
    source = tmp_path / "candidate.wav"
    write_noise_wav(source, 13)
    kept = register_standard_voice(voice_library, source, {"source_voice_id": "voice-upload-source"})
    removed = register_standard_voice(voice_library, source, {"source_voice_id": "voice-upload-other"})
    project_dir = project_root / "demo"
    project_dir.mkdir()
    (project_dir / "project.json").write_text(json.dumps({
        "roles": [["narrator", "旁白", "narrator", "profile", "voice", kept]],
        "character_assets": {},
    }), encoding="utf-8")

    deleted = cleanup_unreferenced_standard_voices(project_root, voice_library, [kept, removed])

    assert deleted == [removed]
    assert (voice_library / f"{kept}.wav").is_file()
    assert not (voice_library / f"{removed}.wav").exists()


def test_standard_reference_generation_keeps_original_as_anchor_and_waits_for_adoption(tmp_path):
    project_root = tmp_path / "outputs" / "novel-projects"
    voice_library = tmp_path / "outputs" / "voice-library"
    project_dir = project_root / "demo"
    (project_dir / "process").mkdir(parents=True)
    voice_library.mkdir(parents=True)
    source_voice_id = "voice-upload-source"
    write_noise_wav(voice_library / f"{source_voice_id}.wav", 17)
    project = {
        "version": 1,
        "project_id": "demo",
        "title": "标准样本测试",
        "content_type": "novel",
        "source_text": "测试原文",
        "guidance": "",
        "document": {},
        "roles": [["narrator", "旁白", "narrator", "负责稳定叙述的旁白角色。", "中性清晰", source_voice_id, "自然叙述", "否"]],
        "segments": [],
        "pronunciations": [],
        "voice_files": [str(voice_library / f"{source_voice_id}.wav")],
        "character_assets": {"narrator": {"reference_audio": {"voice_id": source_voice_id}}},
        "director_history": [],
        "director_memory": {},
    }
    (project_dir / "project.json").write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")

    class FakeModel:
        def __init__(self):
            self.anchors = []
            self.calls = 0

        def infer(self, **kwargs):
            self.anchors.append(kwargs["spk_audio_prompt"])
            self.calls += 1
            write_noise_wav(Path(kwargs["output_path"]), 100 + self.calls)
            return kwargs["output_path"]

        @staticmethod
        def speaker_similarity(reference_audio_path, candidate_audio_path):
            return 0.86

    model = FakeModel()

    class FakeRuntime:
        model_lock = threading.Lock()

        @staticmethod
        def get_model(root, status):
            return object(), object(), NovelProjectStore, object(), object(), model, False

    result = render_worker.execute_standard_reference_request({
        "root": str(tmp_path),
        "project_id": "demo",
        "standard_reference": {
            "role_id": "narrator",
            "pace_preset": "舒缓",
            "audition_text": "这是用于标准角色参考样本的固定试听文本。",
            "language": "ZH",
        },
    }, tmp_path / "result.json", tmp_path / "status.json", FakeRuntime())

    saved = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    standard = saved["character_assets"]["narrator"]["standard_reference"]
    assert result["candidate_count"] == 3
    assert result["passing_count"] == 3
    assert saved["roles"][0][5] == source_voice_id
    assert standard["source_voice_id"] == source_voice_id
    assert all(not candidate["selected"] for candidate in standard["candidates"])
    assert all(Path(anchor) == voice_library / f"{source_voice_id}.wav" for anchor in model.anchors)
    assert not list((project_dir / "process" / "standard-reference-staging").glob("*"))
