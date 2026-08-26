from director_memory import reapply_director_memory


def _role(role_id="narrator", name="旁白", kind="narrator"):
    return [role_id, name, kind, "人工补充的小传", "中性清晰", "voice.wav", "自然叙述", "否"]


def _segment(order, source, role_id="narrator", role_name="旁白", text=None, emotion="平静"):
    return [order, "正文", role_id, role_name, "ZH", source, source if text is None else text, "中性叙述", emotion, 0.5, "自然", 300]


def test_reapplies_authored_boundaries_roles_and_text_edits_to_unchanged_content():
    previous_roles = [_role(), _role("hero", "林澈", "character")]
    previous_segments = [
        _segment(1, "他说："),
        _segment(2, "重庆银行。", "hero", "林澈", "重 庆 银行。", "紧张"),
    ]
    generated_roles = [_role(), _role("role_001", "林澈", "character")]
    generated_segments = [
        _segment(1, "他说：重庆银行。", "role_001", "林澈"),
    ]

    roles, segments, report = reapply_director_memory(
        "他说：重庆银行。", "他说：重庆银行。", previous_roles, previous_segments, generated_roles, generated_segments
    )

    assert [row[5] for row in segments] == ["他说：", "重庆银行。"]
    assert segments[1][2:4] == ["hero", "林澈"]
    assert segments[1][6] == "重 庆 银行。"
    assert segments[1][8] == "紧张"
    assert roles[1][0] == "hero"
    assert report["applied"] is True
    assert report["preserved_text_edits"] == 1


def test_maps_old_boundaries_around_inserted_manuscript_text_and_resets_changed_synthesis_text():
    previous = [_segment(1, "第一句。"), _segment(2, "第二句。", text="第 二 句。")]
    generated = [_segment(1, "第一句。新增句。第二句修改。")]

    _roles, segments, report = reapply_director_memory(
        "第一句。第二句。", "第一句。新增句。第二句修改。", [_role()], previous, [_role()], generated
    )

    assert "".join(row[5] for row in segments) == "第一句。新增句。第二句修改。"
    assert segments[-1][6] == segments[-1][5]
    assert report["source_similarity"] >= 0.35


def test_keeps_text_inserted_before_the_first_historical_boundary():
    _roles, segments, report = reapply_director_memory(
        "第一句。第二句。", "新增开头。第一句。第二句。", [_role()], [_segment(1, "第一句。"), _segment(2, "第二句。")],
        [_role()], [_segment(1, "新增开头。第一句。第二句。")]
    )

    assert "".join(row[5] for row in segments) == "新增开头。第一句。第二句。"
    assert report["applied"] is True


def test_declines_to_reapply_memory_when_the_manuscript_is_unrelated():
    roles, segments, report = reapply_director_memory(
        "完全不同的旧稿内容。", "ABC 123 unrelated.", [_role()], [_segment(1, "完全不同的旧稿内容。")], [_role()], [_segment(1, "ABC 123 unrelated.")]
    )

    assert segments[0][5] == "ABC 123 unrelated."
    assert report["applied"] is False
    assert "差异过大" in report["reason"]
