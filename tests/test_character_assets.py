from character_assets import infer_character_gender, normalize_character_assets, recommend_pitch_range


def test_pitch_recommendations_distinguish_demographics():
    assert recommend_pitch_range("male", 35) == (85, 180, 132)
    assert recommend_pitch_range("female", 35) == (165, 255, 210)
    assert recommend_pitch_range("unspecified", 10) == (190, 340, 265)


def test_legacy_roles_receive_stable_character_assets():
    roles = [["role_001", "林澈", "character", "三十五岁的男性刑警，性格克制。", "低沉厚实", "", "自然叙述", "是"]]
    assets = normalize_character_assets(roles)
    assert assets["role_001"]["gender"] == "male"
    assert assets["role_001"]["age"] == 35
    assert assets["role_001"]["pitch_min_hz"] == 85
    assert assets["role_001"]["pitch_target_hz"] == 132
    assert assets["role_001"]["portrait_style"] == "cinematic_manga"
    assert assets["role_001"]["voice_generation"]["preset"] == "balanced"
    assert assets["role_001"]["voice_generation"]["candidate_count"] == 3
    assert assets["role_001"]["audition_text"]


def test_existing_portrait_metadata_survives_normalization():
    roles = [["role_001", "林澈", "character", "人物小传", "中性清晰", "", "自然叙述", "否"]]
    assets = normalize_character_assets(roles, {"role_001": {"gender": "male", "age": 70, "pitch_min_hz": 75, "pitch_max_hz": 165, "pitch_target_hz": 90, "portrait_url": "/portrait.png", "portrait_style": "noir_ink", "portrait_notes": "保留旧式礼帽"}})
    assert assets["role_001"]["portrait_url"] == "/portrait.png"
    assert assets["role_001"]["pitch_target_hz"] == 90
    assert assets["role_001"]["portrait_style"] == "noir_ink"
    assert assets["role_001"]["portrait_notes"] == "保留旧式礼帽"


def test_gender_inference_keeps_unknown_roles_explicit():
    assert infer_character_gender("温和而克制") == "unspecified"


def test_unknown_portrait_style_falls_back_to_default_comic_style():
    roles = [["role_001", "林澈", "character", "人物小传", "中性清晰", "", "自然叙述", "否"]]
    assets = normalize_character_assets(roles, {"role_001": {"portrait_style": "unknown-commercial-style"}})
    assert assets["role_001"]["portrait_style"] == "cinematic_manga"


def test_age_defaults_create_distinct_voice_trait_profiles():
    roles = [["role_001", "教授", "character", "人物小传", "中性清晰", "", "自然叙述", "是"]]
    child = normalize_character_assets(roles, {"role_001": {"age": 10}})["role_001"]
    older = normalize_character_assets(roles, {"role_001": {"age": 72}})["role_001"]
    assert child["voice_traits"]["brightness"] > older["voice_traits"]["brightness"]
    assert child["voice_traits"]["resonance"] > older["voice_traits"]["resonance"]
    assert older["voice_traits"]["roughness"] > child["voice_traits"]["roughness"]
