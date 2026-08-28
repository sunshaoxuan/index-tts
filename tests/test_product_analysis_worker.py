from pathlib import Path

from product_analysis_worker import analysis_voice_ids, merge_analysis_roles


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


def test_merge_analysis_roles_reuses_existing_assets_and_appends_new_roles():
    existing = [
        ["narrator", "旁白", "narrator", "原旁白资产", "成熟稳重", "voice-old-narrator", "沉稳舒缓", "否"],
        ["role_001", "笹垣", "character", "原人物资产", "低沉厚实", "voice-old-sasagaki", "自然叙述", "否"],
        ["role_008", "旧篇路人", "character", "保留资产", "中性清晰", "voice-old-extra", "自然叙述", "否"],
    ]
    generated = [
        ["ai_narrator", "旁白", "narrator", "AI 旁白", "中性清晰", "voice-new", "自然叙述", "否"],
        ["ai_detective", "笹垣", "character", "AI 笹垣", "中性清晰", "voice-new", "自然叙述", "否"],
        ["role_001", "松浦勇", "character", "新增人物", "中性清晰", "voice-new", "自然叙述", "否"],
    ]
    segments = [
        [1, "正文", "ai_detective", "笹垣", "ZH", "甲。", "甲。", "中性叙述", "平静", 0.5, "自然", 200],
        [2, "正文", "role_001", "松浦勇", "ZH", "乙。", "乙。", "中性叙述", "平静", 0.5, "自然", 200],
    ]
    document = {
        "characters": [
            {"id": "ai_narrator", "name": "旁白", "kind": "narrator"},
            {"id": "ai_detective", "name": "笹垣", "kind": "character"},
            {"id": "role_001", "name": "松浦勇", "kind": "character"},
        ],
        "segments": [
            {"speaker_id": "ai_detective", "speaker_name": "笹垣"},
            {"speaker_id": "role_001", "speaker_name": "松浦勇"},
        ],
    }

    roles, merged_segments, report = merge_analysis_roles(document, existing, generated, segments)

    assert roles[:3] == existing
    assert roles[3][1] == "松浦勇"
    assert roles[3][0] == "role_002"
    assert roles[3][5] == ""
    assert roles[3][7] == "是"
    assert merged_segments[0][2:4] == ["role_001", "笹垣"]
    assert merged_segments[1][2:4] == ["role_002", "松浦勇"]
    assert document["characters"][1]["id"] == "role_001"
    assert document["characters"][2]["id"] == "role_002"
    assert document["segments"][1]["speaker_id"] == "role_002"
    assert report == {
        "existing_roles": 3,
        "reused_roles": 2,
        "new_roles": 1,
        "new_roles_pending_voice_selection": 1,
        "retained_unmentioned_roles": 1,
        "generated_to_final": {"ai_narrator": "narrator", "ai_detective": "role_001", "role_001": "role_002"},
    }
