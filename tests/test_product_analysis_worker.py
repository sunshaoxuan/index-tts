from pathlib import Path

from product_analysis_worker import (
    analysis_voice_ids,
    attach_analysis_total_metrics,
    apply_analysis_demographics,
    apply_validated_character_profiles,
    current_document_with_project_segments,
    enforce_single_anchor_tables,
    linked_article_demographic_reference,
    merge_analysis_roles,
    prepare_single_anchor_analysis,
)


def test_analysis_total_metrics_include_chunk_pipeline_and_character_review():
    document = {
        "metrics": {
            "prompt_tokens": 100,
            "output_tokens": 40,
            "duration_seconds": 3.5,
            "classification_requests": 1,
            "context_requests": 1,
            "chunks": 2,
            "stage_metrics": {"gender_suggestion": {"requests": 1}},
        },
        "character_validation": {
            "rounds": [
                {"prompt_tokens": 20, "output_tokens": 8, "duration_seconds": 0.7, "repair_attempts": 1},
                {"prompt_tokens": 22, "output_tokens": 6, "duration_seconds": 0.5, "repair_attempts": 0},
            ]
        },
    }

    metrics = attach_analysis_total_metrics(document)

    assert metrics["stage_metrics"]["character_validation"] == {
        "requests": 3,
        "prompt_tokens": 42,
        "output_tokens": 14,
        "duration_seconds": 1.2,
    }
    assert metrics["total_requests"] == 8
    assert metrics["total_prompt_tokens"] == 142
    assert metrics["total_output_tokens"] == 54
    assert metrics["total_model_duration_seconds"] == 4.7


def test_storyboard_regeneration_uses_current_user_edited_segments():
    project = {
        "roles": [["narrator", "旁白", "narrator"]],
        "segments": [[1, "第 1 章", "narrator", "旁白", "ZH", "当前原文", "人工朗读文字", "中性叙述", "平静", 0.4, "自然", 250]],
        "document": {
            "characters": [{"id": "narrator"}],
            "segments": [{"order": 1, "source_text": "旧原文", "text": "旧朗读", "scene_id": "scene_old", "speaker_confidence": 0.8}],
        },
    }

    document = current_document_with_project_segments(project)

    assert document["characters"] == [{"id": "narrator"}]
    assert document["segments"][0]["source_text"] == "当前原文"
    assert document["segments"][0]["text"] == "人工朗读文字"
    assert document["segments"][0]["speaker_kind"] == "narrator"
    assert document["segments"][0]["speaker_confidence"] == 0.8


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


def test_single_anchor_analysis_preserves_manual_anchor_and_drops_article_people():
    document = {
        "characters": [
            {"id": "anchor", "name": "主播", "kind": "anchor", "profile": "AI 默认主播", "voice_hint": "中性"},
            {"id": "role_001", "name": "稿件人物", "kind": "character"},
        ],
        "segments": [{"speaker_id": "anchor", "speaker_name": "主播", "speaker_kind": "anchor", "speaker_candidates": ["anchor"]}],
        "scenes": [{"participants": ["role_001"]}],
    }
    existing = [
        ["anchor_manual", "晚间主播", "anchor", "使用者设置的主播说明", "成熟克制", "voice-anchor", "舒缓", "否"],
        ["role_old", "旧人物", "character", "旧人物资产", "低沉", "voice-old", "自然", "否"],
    ]
    previous_document = {"characters": [{"id": "anchor_manual", "name": "晚间主播", "kind": "anchor"}, {"id": "role_old", "name": "旧人物", "kind": "character"}]}

    retained, previous = prepare_single_anchor_analysis(document, existing, previous_document)

    assert retained == [existing[0]]
    assert previous == [previous_document["characters"][0]]
    assert len(document["characters"]) == 1
    assert document["characters"][0]["id"] == "anchor_manual"
    assert document["characters"][0]["name"] == "晚间主播"
    assert document["characters"][0]["profile"] == "使用者设置的主播说明"
    assert document["segments"][0]["speaker_id"] == "anchor_manual"
    assert document["scenes"][0]["participants"] == ["anchor_manual"]


def test_single_anchor_tables_force_all_segments_to_the_only_anchor():
    document = {
        "characters": [{"id": "anchor", "name": "主播", "kind": "anchor"}, {"id": "role_001", "name": "人物", "kind": "character"}],
        "segments": [{"speaker_id": "role_001", "speaker_name": "人物", "speaker_kind": "character"}],
        "scenes": [{"participants": ["role_001"]}],
    }
    roles = [["anchor", "主播", "anchor", "唯一主播", "中性", "voice.wav", "自然", "否"]]
    segments = [[1, "正文", "role_001", "人物", "ZH", "原文", "原文", "中性叙述", "平静", 0.5, "自然", 0]]

    enforce_single_anchor_tables(document, roles, segments)

    assert [item["id"] for item in document["characters"]] == ["anchor"]
    assert document["segments"][0]["speaker_id"] == "anchor"
    assert document["scenes"][0]["participants"] == ["anchor"]
    assert segments[0][2:4] == ["anchor", "主播"]


def test_anchor_demographics_remain_manual_and_are_not_inferred_from_article_people():
    roles = [["anchor", "主播", "anchor", "唯一主播", "中性清晰", "voice.wav", "自然", "否"]]
    document = {"characters": [{"id": "anchor", "name": "主播", "kind": "anchor", "age": None, "gender": "unspecified"}]}
    existing = {"anchor": {"age": 48, "gender": "female", "age_source": "user", "gender_source": "user"}}

    assets, report = apply_analysis_demographics(document, roles, existing)

    assert assets["anchor"]["age"] == 48
    assert assets["anchor"]["gender"] == "female"
    assert assets["anchor"]["age_source"] == "user"
    assert assets["anchor"]["gender_source"] == "user"
    assert report == {"analyzed": 0, "changed": 0}


def test_narrator_gender_inference_updates_character_asset_without_requiring_age():
    roles = [["narrator", "旁白", "narrator", "第一人称叙述者", "成熟声音", "voice.wav", "自然", "否"]]
    document = {"characters": [{
        "id": "narrator", "name": "旁白", "kind": "narrator", "age": None,
        "gender": "male", "gender_evidence": "第一人称叙述者提到自己的女友",
        "gender_basis": "current_inference",
    }]}

    assets, report = apply_analysis_demographics(document, roles, {"narrator": {"age": 35, "gender": "unspecified"}})

    assert assets["narrator"]["gender"] == "male"
    assert assets["narrator"]["gender_basis"] == "current_inference"
    assert assets["narrator"]["gender_evidence"] == "第一人称叙述者提到自己的女友"
    assert assets["narrator"]["age"] == 35
    assert report == {"analyzed": 1, "changed": 1}


def test_narrator_gender_inference_preserves_a_manual_gender_choice():
    roles = [["narrator", "旁白", "narrator", "第一人称叙述者", "成熟声音", "voice.wav", "自然", "否"]]
    document = {"characters": [{
        "id": "narrator", "name": "旁白", "kind": "narrator", "age": None,
        "gender": "male", "gender_evidence": "第一人称叙述者提到自己的女友",
        "gender_basis": "current_inference",
    }]}
    existing = {"narrator": {"age": 42, "gender": "female", "gender_source": "manual"}}

    assets, report = apply_analysis_demographics(document, roles, existing)

    assert assets["narrator"]["gender"] == "female"
    assert assets["narrator"]["gender_source"] == "manual"
    assert assets["narrator"]["age"] == 42
    assert report == {"analyzed": 1, "changed": 0}


def test_linked_article_text_is_supplied_as_ai_demographic_reference():
    projects = {
        "article-02": {
            "project_id": "article-02",
            "title": "白夜行02",
            "source_text": "被害人的年龄是五十二岁。桐原洋介是桐原当铺老板。",
            "linked_projects": [{"source_project_id": "article-01"}],
        },
        "article-01": {
            "project_id": "article-01",
            "title": "白夜行01",
            "source_text": "死者年约四十五到五十出头。",
            "linked_projects": [],
        },
    }

    class Store:
        def load(self, project_id):
            return projects[project_id]

    current = {
        "project_id": "article-03",
        "linked_projects": [{"source_project_id": "article-02"}],
    }
    reference = linked_article_demographic_reference(Store(), current)

    assert "白夜行02" in reference
    assert "被害人的年龄是五十二岁" in reference
    assert "白夜行01" in reference


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
        "merged_duplicate_existing_roles": {},
        "generated_to_final": {"ai_narrator": "narrator", "ai_detective": "role_001", "role_001": "role_002"},
    }


def test_merge_analysis_roles_reuses_user_confirmed_alias_from_previous_document():
    existing = [
        ["narrator", "旁白", "narrator", "旁白资产", "中性清晰", "voice-narrator", "自然叙述", "否"],
        ["role_existing", "桐原弥生子", "character", "前篇角色资产", "成熟克制", "voice-existing", "自然叙述", "否"],
    ]
    generated = [
        ["ai_wife", "死者妻子", "character", "本篇识别结果", "悲伤女性", "", "自然叙述", "是"],
    ]
    segments = [[1, "正文", "ai_wife", "死者妻子", "ZH", "甲。", "甲。", "中性叙述", "平静", 0.5, "自然", 200]]
    document = {
        "characters": [{"id": "ai_wife", "name": "死者妻子", "kind": "character", "aliases": ["老板娘"]}],
        "segments": [{"speaker_id": "ai_wife", "speaker_name": "死者妻子"}],
    }
    previous_characters = [{"id": "role_existing", "name": "桐原弥生子", "kind": "character", "aliases": ["死者妻子", "弥生子"]}]

    roles, merged_segments, report = merge_analysis_roles(document, existing, generated, segments, previous_characters)

    assert roles == existing
    assert merged_segments[0][2:4] == ["role_existing", "桐原弥生子"]
    assert document["characters"][0]["id"] == "role_existing"
    assert document["characters"][0]["name"] == "桐原弥生子"
    assert document["segments"][0]["speaker_id"] == "role_existing"
    assert report["reused_roles"] == 1
    assert report["new_roles"] == 0
    assert report["generated_to_final"] == {"ai_wife": "role_existing"}


def test_alias_match_reuses_same_person_and_current_demographics_override_defaults():
    existing = [["role_013", "桐原亮", "character", "桐原洋介的儿子。", "少年声线", "voice-child", "自然叙述", "否"]]
    generated = [["role_001", "桐原亮司", "character", "桐原洋介的儿子，十至十一岁。", "男童声线", "voice-new", "自然叙述", "否"]]
    document = {
        "characters": [{
            "id": "role_001", "name": "桐原亮司", "kind": "character", "aliases": ["桐原亮"],
            "gender": "male", "gender_evidence": "原文称其为儿子", "age": 10, "age_evidence": "原文写明十至十一岁",
        }],
        "segments": [],
    }

    roles, _segments, report = merge_analysis_roles(document, existing, generated, [], [])
    assets, demographics = apply_analysis_demographics(document, roles, {"role_013": {"gender": "unspecified", "age": 35}})

    assert len(roles) == 1
    assert roles[0][0] == "role_013"
    assert document["characters"][0]["id"] == "role_013"
    assert assets["role_013"]["age"] == 10
    assert assets["role_013"]["gender"] == "male"
    assert assets["role_013"]["pitch_min_hz"] == 190
    assert assets["role_013"]["pitch_max_hz"] == 320
    assert assets["role_013"]["age_source"] == "ai_article_inference"
    assert assets["role_013"]["gender_source"] == "ai_article_inference"
    assert roles[0][7] == "是"
    assert report["reused_roles"] == 1
    assert demographics == {"analyzed": 1, "changed": 1}


def test_relationship_and_name_prefix_merge_kirihara_ryo_with_ryoji():
    existing = [[
        "role_013", "桐原亮", "character",
        "桐原亮是桐原洋介与弥生子的儿子，目前读小学五年级。",
        "男童声线", "voice-child", "自然叙述", "否",
    ]]
    generated = [[
        "role_new", "桐原亮司", "character",
        "桐原洋介的儿子，穿着小学五年级的校服。",
        "男童声线", "", "自然叙述", "是",
    ]]
    document = {
        "characters": [{
            "id": "role_new", "name": "桐原亮司", "kind": "character",
            "aliases": ["桐原洋介的儿子"], "profile": "桐原洋介的儿子，穿着小学五年级的校服。",
            "gender": "male", "age": 10,
        }],
        "segments": [],
    }

    roles, _segments, report = merge_analysis_roles(document, existing, generated, [], [])

    assert len(roles) == 1
    assert roles[0][0] == "role_013"
    assert report["generated_to_final"] == {"role_new": "role_013"}
    assert report["new_roles"] == 0
    assert document["characters"][0]["id"] == "role_013"
    assert document["characters"][0]["name"] == "桐原亮"
    assert "桐原亮司" in document["characters"][0]["aliases"]


def test_relationship_merge_removes_unvoiced_existing_full_name_duplicate():
    existing = [
        [
            "role_013", "桐原亮", "character",
            "桐原亮是桐原洋介与弥生子的儿子，目前读小学五年级。",
            "男童声线", "voice-child", "自然叙述", "否",
        ],
        [
            "role_008", "桐原亮司", "character",
            "桐原洋介的儿子，穿着小学五年级的校服。",
            "男童声线", "", "自然叙述", "是",
        ],
    ]
    generated = [[
        "ai_child", "桐原亮司", "character",
        "桐原洋介的儿子，穿着小学五年级的校服。",
        "男童声线", "", "自然叙述", "是",
    ]]
    document = {
        "characters": [{
            "id": "ai_child", "name": "桐原亮司", "kind": "character",
            "aliases": ["桐原洋介的儿子"], "profile": "桐原洋介的儿子，穿着小学五年级的校服。",
            "gender": "male", "age": 10,
        }],
        "segments": [],
    }

    roles, _segments, report = merge_analysis_roles(document, existing, generated, [], [])

    assert [row[0] for row in roles] == ["role_013"]
    assert report["generated_to_final"] == {"ai_child": "role_013"}
    assert report["merged_duplicate_existing_roles"] == {"role_008": "role_013"}
    assert document["characters"][0]["id"] == "role_013"
    assert "桐原亮司" in document["characters"][0]["aliases"]


def test_same_person_uses_current_article_inference_instead_of_inheriting_assets():
    roles = [["role_013", "桐原亮", "character", "桐原洋介的儿子。", "少年声线", "voice-child", "自然叙述", "否"]]
    document = {"characters": [{"id": "role_013", "name": "桐原亮", "kind": "character", "gender": "male", "gender_evidence": "根据儿子称谓推断", "age": 11, "age_evidence": "根据小学阶段和时间线推断约十一岁"}], "segments": []}

    assets, report = apply_analysis_demographics(document, roles, {"role_013": {"gender": "male", "age": 10, "pitch_min_hz": 190, "pitch_max_hz": 320, "pitch_target_hz": 255}})

    assert assets["role_013"]["age"] == 11
    assert assets["role_013"]["gender"] == "male"
    assert assets["role_013"]["pitch_target_hz"] == 255
    assert assets["role_013"]["age_evidence"] == "根据小学阶段和时间线推断约十一岁"
    assert roles[0][7] == "是"
    assert report == {"analyzed": 1, "changed": 1}


def test_character_without_current_article_age_inference_is_rejected():
    roles = [["role_013", "桐原亮", "character", "人物小传", "少年声线", "voice-child", "自然叙述", "否"]]
    document = {"characters": [{"id": "role_013", "name": "桐原亮", "kind": "character", "gender": "male", "age": None}], "segments": []}

    try:
        apply_analysis_demographics(document, roles, {"role_013": {"gender": "male", "age": 10}})
    except ValueError as error:
        assert "缺少文章证据支持的年龄推断" in str(error)
    else:
        raise AssertionError("缺少当前文章年龄推断时必须拒绝分析结果")


def test_demographic_merge_preserves_linked_roles_absent_from_current_ai_roster():
    roles = [
        ["role_current", "当前人物", "character", "当前人物小传", "男声", "", "自然叙述", "否"],
        ["role_linked", "关联人物", "character", "关联人物小传", "女声", "", "自然叙述", "否"],
    ]
    document = {
        "characters": [{
            "id": "role_current", "name": "当前人物", "kind": "character",
            "gender": "male", "gender_evidence": "文章称其为父亲", "gender_basis": "current_explicit",
            "age": 52, "age_evidence": "关联文章明确写明五十二岁", "age_basis": "linked_explicit",
        }],
        "segments": [],
    }
    existing_assets = {
        "role_linked": {
            "gender": "female", "age": 55, "pitch_min_hz": 165,
            "pitch_max_hz": 255, "pitch_target_hz": 210, "voice_candidates": [{"voice_id": "voice-linked"}],
        }
    }

    assets, report = apply_analysis_demographics(document, roles, existing_assets)

    assert assets["role_current"]["age"] == 52
    assert assets["role_current"]["age_basis"] == "linked_explicit"
    assert assets["role_linked"]["age"] == 55
    assert assets["role_linked"]["gender"] == "female"
    assert assets["role_linked"]["pitch_target_hz"] == 210
    assert assets["role_linked"]["voice_candidates"] == [{"voice_id": "voice-linked"}]
    assert report == {"analyzed": 1, "changed": 0}


def test_validated_ai_profile_replaces_old_role_bio_without_changing_voice_fields():
    roles = [[
        "role_013", "桐原亮", "character", "旧小传写年龄未说明。",
        "低沉而沉默的男孩声音。", "voice-child", "沉稳舒缓", "否",
    ]]
    document = {"characters": [{
        "id": "role_013", "name": "桐原亮", "kind": "character",
        "profile": "桐原洋介的儿子，穿着小学五年级校服，十至十一岁。",
    }]}

    report = apply_validated_character_profiles(document, roles)

    assert roles[0][3] == "桐原洋介的儿子，穿着小学五年级校服，十至十一岁。"
    assert roles[0][4:] == ["低沉而沉默的男孩声音。", "voice-child", "沉稳舒缓", "否"]
    assert report == {"analyzed": 1, "changed": 1}
