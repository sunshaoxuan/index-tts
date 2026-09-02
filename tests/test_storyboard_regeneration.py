from storyboard_regeneration import regenerate_storyboard_document


def test_regenerates_only_storyboard_against_current_segment_boundaries() -> None:
    existing = {
        "characters": [{"id": "narrator", "name": "旁白"}],
        "segments": [
            {"order": 1, "source_text": "甲。", "text": "人工朗读甲。", "speaker_id": "narrator", "scene_id": "old"},
            {"order": 2, "source_text": "乙。丙。", "text": "人工朗读乙丙。", "speaker_id": "role_01", "scene_id": "old"},
        ],
        "scenes": [{"id": "old", "keyframe_url": "/old.png"}],
        "character_validation": {"all_valid": True},
    }
    analyzed = {
        "segments": [
            {"order": 1, "source_text": "甲。乙。", "scene_id": "scene_001"},
            {"order": 2, "source_text": "丙。", "scene_id": "scene_002"},
        ],
        "scenes": [
            {"id": "scene_001", "title": "甲乙", "keyframe_url": "/generated.png"},
            {"id": "scene_002", "title": "丙"},
        ],
    }

    result = regenerate_storyboard_document(existing, analyzed, captions=[
        {"order": 1, "durationSeconds": 6.0, "pauseAfterMs": 0},
        {"order": 2, "durationSeconds": 11.0, "pauseAfterMs": 500},
    ])

    assert [item["scene_id"] for item in result["segments"]] == ["scene_001", "scene_002"]
    assert result["segments"][0]["text"] == "人工朗读甲。"
    assert result["character_validation"] == {"all_valid": True}
    assert result["scenes"][0]["participants"] == ["narrator"]
    assert result["scenes"][1]["participants"] == ["role_01"]
    assert "keyframe_url" not in result["scenes"][0]
    assert result["storyboard_regeneration"]["preserved_audio_segments"] is True
    assert result["storyboard_regeneration"]["shot_count"] == 2
    assert result["scenes"][0]["shots"][0]["start_seconds"] == 0.0
    assert result["scenes"][0]["shots"][0]["end_seconds"] == 6.0
    assert result["scenes"][1]["shots"][0]["start_seconds"] == 6.0
    assert result["scenes"][1]["shots"][0]["end_seconds"] == 17.5
    assert result["scenes"][0]["shots"][0]["source_text"] == "甲。"
    assert result["scenes"][1]["shots"][0]["source_text"] == "乙。丙。"
    assert result["scenes"][0]["shots"][0]["storyboard_note"] == ""
    assert result["scenes"][0]["shots"][0]["authoring"] == "pending_ai"
    assert result["storyboard_regeneration"]["shot_notes_authored_by_ai"] is False


def test_rejects_storyboard_regeneration_when_source_coverage_changed() -> None:
    existing = {"segments": [{"order": 1, "source_text": "甲。", "speaker_id": "narrator"}]}
    analyzed = {
        "segments": [{"order": 1, "source_text": "甲。乙。", "scene_id": "scene_001"}],
        "scenes": [{"id": "scene_001"}],
    }

    try:
        regenerate_storyboard_document(existing, analyzed)
    except ValueError as exc:
        assert "原文覆盖不一致" in str(exc)
    else:
        raise AssertionError("expected coverage mismatch")


def test_twenty_minute_audio_builds_about_one_hundred_twenty_shots_at_ten_seconds() -> None:
    existing_segments = [
        {"order": order, "source_text": f"第{order}句。", "text": f"第{order}句。", "speaker_id": "narrator", "scene_id": "old"}
        for order in range(1, 121)
    ]
    existing = {"segments": existing_segments, "scenes": [{"id": "old"}]}
    analyzed = {
        "segments": [{"order": item["order"], "source_text": item["source_text"], "scene_id": "scene_001"} for item in existing_segments],
        "scenes": [{"id": "scene_001", "title": "长场景", "storyboard_note": "同一地点内连续发生的长场景，镜头需要跟随每段动作和叙述变化保持视觉推进。"}],
    }
    captions = [{"order": order, "durationSeconds": 10.0, "pauseAfterMs": 0} for order in range(1, 121)]

    result = regenerate_storyboard_document(existing, analyzed, captions=captions, target_shot_seconds=10)

    assert result["storyboard_regeneration"]["shot_count"] == 120
    assert result["scenes"][0]["shots"][0]["start_seconds"] == 0.0
    assert result["scenes"][0]["shots"][-1]["end_seconds"] == 1200.0
    assert result["scenes"][0]["shots"][0]["source_text"] == "第1句。"
    assert result["scenes"][0]["shots"][1]["source_text"] == "第2句。"
    assert all(shot["storyboard_note"] == "" for shot in result["scenes"][0]["shots"])
