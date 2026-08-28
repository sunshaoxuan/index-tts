from pathlib import Path

from product_analysis_worker import analysis_voice_ids


def test_analysis_voice_ids_use_project_and_library_voices_without_examples(tmp_path: Path):
    library = tmp_path / "outputs" / "voice-library"
    library.mkdir(parents=True)
    current = library / "voice-current.wav"
    candidate = library / "voice-candidate.wav"
    extra = library / "voice-extra.wav"
    for path in (current, candidate, extra):
        path.write_bytes(b"RIFF")

    project = {
        "roles": [["role_001", "角色", "character", "", "", "voice-current", "自然", "否"]],
        "character_assets": {
            "role_001": {
                "voice_candidates": [
                    {"voice_id": "voice-candidate"},
                    {"voice_id": "voice-current"},
                    {"voice_id": "voice-missing"},
                ]
            }
        },
        "voice_files": [str(current), str(candidate)],
    }

    assert analysis_voice_ids(tmp_path, project) == ["voice-current", "voice-candidate", "voice-extra"]


def test_analysis_voice_ids_fall_back_to_optional_example_voices(tmp_path: Path):
    examples = tmp_path / "examples"
    examples.mkdir()
    (examples / "voice_01.wav").write_bytes(b"RIFF")

    assert analysis_voice_ids(tmp_path, {}) == ["voice_01.wav"]
