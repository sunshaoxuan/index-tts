import json
import threading
import wave
import zipfile
from pathlib import Path

import pytest

from novel_project import assign_numbered_chapter_sections

from text_director import (
    DIRECTOR_SCHEMA,
    DirectorConfig,
    DirectorCancelled,
    DirectorError,
    DirectorTimeout,
    DirectorValidationError,
    OllamaTextDirector,
    ATTITUDE_PRESETS,
    EMOTION_DIRECTION_PRESETS,
    PACE_PRESETS,
    ROLE_HEADERS,
    RHYTHM_PRESETS,
    SEGMENT_HEADERS,
    VOICE_STYLE_PRESETS,
    analyze_segment_candidate,
    concatenate_wav_segments,
    apply_generated_voices,
    build_voice_design_jobs,
    coverage_key,
    document_to_tables,
    migrate_attitude_preset,
    migrate_emotion_label,
    migrate_segment_rows,
    migrate_pace_preset,
    migrate_rhythm_preset,
    render_directed_audio,
    is_speech_attribution,
    infer_voice_gender,
    guidance_role_signature,
    validate_guidance_assignments,
    split_document,
    split_exact_sentences,
    tables_to_script,
)


def _character(role_id="narrator", name="旁白", kind="narrator"):
    character = {
        "id": role_id,
        "name": name,
        "kind": kind,
        "profile": "测试角色",
        "voice_hint": "稳定自然",
    }
    if kind != "narrator":
        character.update({
            "gender": "male",
            "gender_evidence": "测试稿件中的人物称谓",
            "age": 30,
            "age_evidence": "测试稿件中的身份和时间线推断",
        })
    return character


def test_director_config_defaults_to_qwen3_14b():
    config = DirectorConfig()
    assert config.model == "qwen3:14b"
    assert config.timeout_seconds == 600
    assert config.hot_request_timeout_seconds == 120
    assert config.chunk_validation_attempts == 2


def test_warm_model_preloads_ollama_with_the_director_context(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"load_duration": 2_500_000_000}

    def post(url, **kwargs):
        captured.update({"url": url, **kwargs})
        return Response()

    monkeypatch.setattr("text_director.requests.post", post)
    metrics = OllamaTextDirector(DirectorConfig()).warm_model()

    assert captured["url"] == "http://127.0.0.1:11434/api/chat"
    assert "messages" not in captured["json"]
    assert captured["json"]["options"]["num_ctx"] == 8192
    assert captured["json"]["keep_alive"] == "30m"
    assert captured["timeout"] == 600
    assert metrics["load_duration_seconds"] == 2.5


def test_hot_ollama_chunk_uses_short_timeout_and_same_context(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "message": {"content": json.dumps(_valid_response(), ensure_ascii=False)},
                "prompt_eval_count": 10,
                "eval_count": 20,
            }

    def post(url, **kwargs):
        captured.update({"url": url, **kwargs})
        return Response()

    monkeypatch.setattr("text_director.requests.post", post)
    OllamaTextDirector(DirectorConfig())._chat("测试")

    assert captured["timeout"] == 120
    assert captured["json"]["options"]["num_ctx"] == 8192


def test_local_analysis_pre_splits_into_bounded_sequential_chunks():
    class PlannedDirector(OllamaTextDirector):
        attempted_chunks = []

        def _analyze_chunk(self, *, chunk, **kwargs):
            self.attempted_chunks.append(chunk)
            return (
                {
                    "content_type": "story",
                    "title": "预拆分测试",
                    "characters": [_character()],
                    "segments": [_segment(1, chunk, chunk)],
                },
                {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.01},
            )

    source = "这一段用于验证本地模型会先拆分任务再逐段解析。" * 80
    progress = []
    result = PlannedDirector(DirectorConfig(
        model="fake",
        max_chunk_chars=1400,
        pre_split_chunk_chars=700,
    )).analyze_document(
        source,
        content_type="story",
        progress=lambda fraction, desc="": progress.append((fraction, desc)),
    )

    assert len(PlannedDirector.attempted_chunks) >= 3
    assert max(map(len, PlannedDirector.attempted_chunks)) <= 700
    assert result["metrics"]["planned_chunks"] == len(PlannedDirector.attempted_chunks)
    assert result["metrics"]["chunk_chars"] == 700
    first_chunk_progress = next(item for item in progress if "逐段解析第 1/" in item[1])
    assert first_chunk_progress[0] == pytest.approx(0.15)


def test_context_prompt_uses_linked_article_demographics_with_explicit_priority():
    director = OllamaTextDirector(DirectorConfig(model="fake", staged_analysis=True))
    prompts = []

    def request_structured(prompt, schema, **kwargs):
        prompts.append(prompt)
        return {
            "content_type": "novel",
            "title": "测试",
            "characters": [],
            "scenes": [],
        }, {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.01}

    director._request_structured = request_structured
    director._analyze_context(
        "桐原洋介的儿子抱着遗照。",
        "novel",
        "",
        "被害人的年龄是五十二岁。",
    )

    assert "被害人的年龄是五十二岁" in prompts[0]
    assert "当前文章明示、关联文章明示、当前文章语境推断、关联文章语境推断" in prompts[0]
    assert "不注册仅在关联文章出现的人物" in prompts[0]


def test_linked_explicit_demographics_survive_weaker_current_inference():
    global_characters = [{
        "id": "role_007",
        "name": "桐原洋介",
        "kind": "character",
        "aliases": [],
        "profile": "桐原当铺老板",
        "voice_hint": "成熟男声",
        "gender": "male",
        "gender_evidence": "关联文章明确称为丈夫",
        "gender_basis": "linked_explicit",
        "age": 52,
        "age_evidence": "关联文章明确写明五十二岁",
        "age_basis": "linked_explicit",
    }]
    result = {
        "characters": [{
            "id": "local-father",
            "name": "桐原洋介",
            "kind": "character",
            "aliases": [],
            "profile": "小学五年级学生的父亲",
            "voice_hint": "成年男声",
            "gender": "male",
            "gender_evidence": "当前文章称其为父亲",
            "gender_basis": "current_inference",
            "age": 35,
            "age_evidence": "根据孩子就学阶段推断",
            "age_basis": "current_inference",
        }],
        "scenes": [],
        "segments": [],
    }

    OllamaTextDirector._merge_chunk(result, global_characters, [], [])

    assert global_characters[0]["age"] == 52
    assert global_characters[0]["age_basis"] == "linked_explicit"


def test_narrator_binary_gender_without_basis_is_normalized_as_current_inference():
    narrator = OllamaTextDirector._normalize_character({
        "id": "narrator", "name": "旁白", "kind": "narrator",
        "profile": "第一人称叙述者", "voice_hint": "成熟声音",
        "gender": "male", "gender_evidence": "根据全文叙事语境判断", "gender_basis": "unknown",
    })

    assert narrator["gender"] == "male"
    assert narrator["gender_basis"] == "current_inference"


def test_first_person_partner_context_resolves_narrator_without_an_extra_request():
    director = OllamaTextDirector(DirectorConfig(model="fake"))
    characters = [{
        "id": "narrator", "name": "旁白", "kind": "narrator",
        "profile": "第一人称叙述者", "voice_hint": "中性自然",
        "gender": "unspecified", "gender_evidence": "", "gender_basis": "unknown",
    }]

    metrics = director._resolve_unset_gender_suggestions(characters, "当时的女友周家梅正在和我闹分手。")

    assert metrics["requests"] == 0
    assert characters[0]["gender"] == "male"
    assert characters[0]["gender_basis"] == "current_inference"
    assert "女友" in characters[0]["gender_evidence"]


def test_unresolved_gender_uses_one_compact_suggestion_request():
    class SuggestionDirector(OllamaTextDirector):
        def _request_structured(self, prompt, schema, **kwargs):
            self.suggestion_prompt = prompt
            return {"suggestions": [{"id": "narrator", "gender": "female", "evidence": "适合作品的女性旁白声音建议"}]}, {
                "prompt_tokens": 40, "output_tokens": 12, "duration_seconds": 0.2,
            }

    director = SuggestionDirector(DirectorConfig(model="fake"))
    characters = [{
        "id": "narrator", "name": "旁白", "kind": "narrator",
        "profile": "负责全文叙述", "voice_hint": "中性自然",
        "gender": "unspecified", "gender_evidence": "", "gender_basis": "unknown",
    }]

    metrics = director._resolve_unset_gender_suggestions(characters, "雨停了，故事仍在继续。")

    assert metrics == {"requests": 1, "prompt_tokens": 40, "output_tokens": 12, "duration_seconds": 0.2}
    assert characters[0]["gender"] == "female"
    assert characters[0]["gender_basis"] == "current_inference"
    assert "不重新分析场景" in director.suggestion_prompt


def test_failed_gender_suggestion_uses_a_visible_manual_confirmation_fallback():
    class FailingSuggestionDirector(OllamaTextDirector):
        def _request_structured(self, prompt, schema, **kwargs):
            raise DirectorError("建议服务暂时不可用")

    characters = [{
        "id": "narrator", "name": "旁白", "kind": "narrator",
        "profile": "负责全文叙述", "voice_hint": "中性自然",
        "gender": "unspecified", "gender_evidence": "", "gender_basis": "unknown",
    }]

    FailingSuggestionDirector(DirectorConfig(model="fake"))._resolve_unset_gender_suggestions(characters, "雨停了。")

    assert characters[0]["gender"] == "male"
    assert characters[0]["gender_basis"] == "unknown"
    assert characters[0]["gender_recommendation_only"] is True
    assert "需人工确认" in characters[0]["gender_evidence"]


def test_current_explicit_demographics_override_linked_explicit_value():
    existing = [{
        "id": "role_007", "name": "桐原洋介", "kind": "character", "aliases": [],
        "profile": "旧篇人物", "voice_hint": "成熟男声", "gender": "male",
        "gender_evidence": "关联文章明确称为丈夫", "gender_basis": "linked_explicit",
        "age": 52, "age_evidence": "关联文章明确写明五十二岁", "age_basis": "linked_explicit",
    }]
    result = {
        "characters": [{
            "id": "local-father", "name": "桐原洋介", "kind": "character", "aliases": [],
            "profile": "当前篇人物", "voice_hint": "成熟男声", "gender": "male",
            "gender_evidence": "当前文章明确称为男性", "gender_basis": "current_explicit",
            "age": 53, "age_evidence": "当前文章明确写明五十三岁", "age_basis": "current_explicit",
        }],
        "scenes": [],
        "segments": [],
    }

    OllamaTextDirector._merge_chunk(result, existing, [], [])

    assert existing[0]["age"] == 53
    assert existing[0]["age_basis"] == "current_explicit"


def test_ai_character_validation_accepts_program_verified_corrections_without_repeating_review():
    class ValidationDirector(OllamaTextDirector):
        def __init__(self):
            super().__init__(DirectorConfig(model="fake"))
            self.context_tokens = []
            self.responses = [
                {
                    "all_valid": False,
                    "summary": "修正桐原洋介年龄",
                    "characters": [{
                        "id": "role_007", "canonical_id": "role_007", "name": "桐原洋介",
                        "status": "corrected", "issues": ["35 岁缺少依据，关联文章明示 52 岁"],
                        "profile": "桐原洋介是五十二岁的桐原当铺老板，也是桐原亮司的父亲。",
                        "profile_evidence": "关联文章写明年龄和当铺老板身份",
                        "gender": "male", "gender_evidence": "原文称其为丈夫和父亲",
                        "gender_basis": "current_explicit", "age": 52,
                        "age_evidence": "关联文章明确写明被害人的年龄是五十二岁",
                        "age_basis": "linked_explicit",
                    }],
                },
            ]

        def _request_structured(self, prompt, schema, **kwargs):
            self.context_tokens.append(kwargs.get("context_tokens"))
            return self.responses.pop(0), {"prompt_tokens": 10, "output_tokens": 20, "duration_seconds": 0.1}

    document = {
        "characters": [{
            "id": "role_007", "name": "桐原洋介", "kind": "character", "aliases": [],
            "profile": "桐原洋介是当铺老板。", "voice_hint": "成年男声",
            "gender": "male", "gender_evidence": "原文称父亲", "gender_basis": "current_inference",
            "age": 35, "age_evidence": "根据父亲身份推断", "age_basis": "current_inference",
        }],
        "segments": [],
        "scenes": [],
    }

    director = ValidationDirector()
    report = director.validate_character_analysis(
        document,
        "桐原洋介的儿子抱着遗照。",
        "被害人的年龄是五十二岁。",
    )

    assert report["all_valid"] is True
    assert report["round_count"] == 1
    assert document["characters"][0]["age"] == 52
    assert report["rounds"][0]["statuses"] == {"role_007": "corrected"}
    assert report["rounds"][0]["accepted_corrected"] is True
    assert director.context_tokens == [8192]


def test_ai_character_validation_splits_roster_into_small_batches():
    class BatchedValidationDirector(OllamaTextDirector):
        def __init__(self):
            super().__init__(DirectorConfig(model="fake"))
            self.batch_ids = [["role_001", "role_002"], ["role_003"]]

        def _request_structured(self, prompt, schema, **kwargs):
            ids = self.batch_ids.pop(0)
            rows = []
            for role_id in ids:
                rows.append({
                    "id": role_id,
                    "canonical_id": role_id,
                    "name": role_id,
                    "status": "pass",
                    "issues": [],
                    "profile": f"{role_id} 是当前文章中需要复核的人物。",
                    "profile_evidence": f"原文出现 {role_id}",
                    "gender": "unspecified",
                    "gender_evidence": "",
                    "gender_basis": "unknown",
                    "age": 30,
                    "age_evidence": "根据当前文章语境推断为成年人",
                    "age_basis": "current_inference",
                })
            return {"all_valid": True, "summary": "当前小批次通过", "characters": rows}, {
                "prompt_tokens": 10,
                "output_tokens": 5,
                "duration_seconds": 0.1,
            }

    document = {
        "characters": [
            {
                "id": role_id, "name": role_id, "kind": "character", "aliases": [],
                "profile": f"{role_id} 是当前文章中的人物。", "voice_hint": "中性清晰",
                "gender": "unspecified", "gender_evidence": "", "gender_basis": "unknown",
                "age": 30, "age_evidence": "根据当前文章语境推断为成年人", "age_basis": "current_inference",
            }
            for role_id in ("role_001", "role_002", "role_003")
        ],
        "segments": [],
        "scenes": [],
    }

    report = BatchedValidationDirector().validate_character_analysis(
        document,
        "role_001 出场。\n无关段落。\nrole_002 出场。\n无关段落。\nrole_003 出场。",
    )

    assert report["all_valid"] is True
    assert report["rounds"][0]["batch_count"] == 2
    assert report["rounds"][0]["requests"] == 2
    assert report["rounds"][0]["prompt_tokens"] == 20


def test_ai_character_validation_retries_only_the_failed_small_batch():
    class IsolatedRetryDirector(OllamaTextDirector):
        def __init__(self):
            super().__init__(DirectorConfig(model="fake"))
            self.requested_batches = []
            self.responses = [
                ["role_001", "role_002"],
                ["role_003", "role_004"],
                ["role_003", "role_004"],
            ]
            self.ages = [30, 30, 25]

        def _request_structured(self, prompt, schema, **kwargs):
            ids = self.responses.pop(0)
            corrected_age = self.ages.pop(0)
            self.requested_batches.append(ids)
            rows = []
            for role_id in ids:
                requires_age_fix = role_id == "role_003" and corrected_age == 30
                rows.append({
                    "id": role_id,
                    "canonical_id": role_id,
                    "name": role_id,
                    "status": "corrected" if requires_age_fix else "pass",
                    "issues": ["年龄应修正为 25"] if requires_age_fix else [],
                    "profile": f"{role_id} 是当前文章中的人物。",
                    "profile_evidence": f"原文出现 {role_id}",
                    "gender": "unspecified",
                    "gender_evidence": "",
                    "gender_basis": "unknown",
                    "age": corrected_age if role_id == "role_003" else 30,
                    "age_evidence": "原文写明年龄" if role_id == "role_003" else "根据语境推断为成年人",
                    "age_basis": "current_explicit" if role_id == "role_003" else "current_inference",
                })
            return {
                "all_valid": not any(row["issues"] for row in rows),
                "summary": "当前小批次复核完成",
                "characters": rows,
            }, {"prompt_tokens": 10, "output_tokens": 5, "duration_seconds": 0.1}

    document = {
        "characters": [
            {
                "id": role_id, "name": role_id, "kind": "character", "aliases": [],
                "profile": f"{role_id} 是当前文章中的人物。", "voice_hint": "中性清晰",
                "gender": "unspecified", "gender_evidence": "", "gender_basis": "unknown",
                "age": 30, "age_evidence": "根据语境推断为成年人", "age_basis": "current_inference",
            }
            for role_id in ("role_001", "role_002", "role_003", "role_004")
        ],
        "segments": [],
        "scenes": [],
    }
    director = IsolatedRetryDirector()
    progress_updates = []

    report = director.validate_character_analysis(
        document,
        "role_001、role_002、role_003 和 role_004 出场。",
        progress=lambda fraction, desc="": progress_updates.append((fraction, desc)),
    )

    assert report["all_valid"] is True
    assert director.requested_batches == [
        ["role_001", "role_002"],
        ["role_003", "role_004"],
        ["role_003", "role_004"],
    ]
    assert report["rounds"][0]["requests"] == 3
    assert report["rounds"][0]["repair_attempts"] == 1
    assert next(item for item in document["characters"] if item["id"] == "role_003")["age"] == 25
    assert [fraction for fraction, _ in progress_updates] == sorted(fraction for fraction, _ in progress_updates)
    assert progress_updates[-1][0] == pytest.approx(0.94)


def test_character_validation_normalizes_unknown_age_basis_when_age_evidence_exists():
    row = OllamaTextDirector._normalize_character_validation({
        "id": "role_005", "canonical_id": "role_005", "name": "小燕子",
        "status": "pass", "issues": [], "profile": "小燕子是丽都酒廊的妈咪。",
        "profile_evidence": "原文写明她是丽都酒廊的妈咪", "gender": "female",
        "gender_evidence": "原文使用女性称谓", "gender_basis": "current_inference",
        "age": 18, "age_evidence": "原文写明她十八岁", "age_basis": "unknown",
    }, {"role_005"})

    assert row["age"] == 18
    assert row["age_evidence"] == "原文写明她十八岁"
    assert row["age_basis"] == "current_inference"


def test_character_validation_normalizes_inferred_gender_basis_with_evidence():
    row = OllamaTextDirector._normalize_character_validation({
        "id": "role_003", "canonical_id": "role_003", "name": "欣雨",
        "status": "pass", "issues": [], "profile": "欣雨是刘至诚的小情人。",
        "profile_evidence": "原文使用小情人称谓", "gender": "female",
        "gender_evidence": "根据姓名和小情人称谓推断", "gender_basis": "unknown",
        "age": 28, "age_evidence": "根据社会关系与语境推断", "age_basis": "current_inference",
    }, {"role_003"})

    assert row["gender_basis"] == "current_inference"


def test_ai_character_validation_merges_duplicate_identity_then_rechecks():
    class ValidationDirector(OllamaTextDirector):
        def __init__(self):
            super().__init__(DirectorConfig(model="fake"))
            shared = {
                "profile": "桐原亮司是桐原洋介的儿子，也是小学五年级学生。",
                "profile_evidence": "当前文章写明父子关系和五年级身份",
                "gender": "male", "gender_evidence": "原文称其为儿子",
                "gender_basis": "current_explicit", "age": 10,
                "age_evidence": "原文写作十至十一岁，范围取下限",
                "age_basis": "linked_explicit",
            }
            self.responses = [
                {
                    "all_valid": False,
                    "summary": "合并重复人物",
                    "characters": [
                        {"id": "role_013", "canonical_id": "role_013", "name": "桐原亮", "status": "corrected", "issues": ["补充全名别名"], **shared},
                        {"id": "role_014", "canonical_id": "role_013", "name": "桐原亮司", "status": "corrected", "issues": ["与桐原亮为同一人物"], **shared},
                    ],
                },
                {
                    "all_valid": True,
                    "summary": "合并后人物设定通过",
                    "characters": [
                        {"id": "role_013", "canonical_id": "role_013", "name": "桐原亮", "status": "pass", "issues": [], **shared},
                    ],
                },
            ]

        def _request_structured(self, prompt, schema, **kwargs):
            return self.responses.pop(0), {"prompt_tokens": 10, "output_tokens": 20, "duration_seconds": 0.1}

    document = {
        "characters": [
            {"id": "role_013", "name": "桐原亮", "kind": "character", "aliases": [], "profile": "男孩", "voice_hint": "男童声"},
            {"id": "role_014", "name": "桐原亮司", "kind": "character", "aliases": [], "profile": "桐原洋介的儿子", "voice_hint": "成年男声"},
        ],
        "segments": [{"speaker_id": "role_014", "speaker_name": "桐原亮司", "speaker_candidates": ["role_014"]}],
        "scenes": [{"participants": ["role_013", "role_014"]}],
    }

    report = ValidationDirector().validate_character_analysis(document, "桐原亮司是桐原洋介的儿子。")

    assert report["round_count"] == 2
    assert [item["id"] for item in document["characters"]] == ["role_013"]
    assert "桐原亮司" in document["characters"][0]["aliases"]
    assert document["segments"][0]["speaker_id"] == "role_013"
    assert document["scenes"][0]["participants"] == ["role_013"]


def test_ai_character_validation_rejects_a_round_that_omits_any_person():
    class IncompleteDirector(OllamaTextDirector):
        def _request_structured(self, prompt, schema, **kwargs):
            return {"all_valid": True, "summary": "遗漏人物", "characters": []}, {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.1}

    document = {
        "characters": [{"id": "role_001", "name": "人物", "kind": "character", "aliases": [], "profile": "测试人物小传", "voice_hint": "测试声音"}],
        "segments": [],
        "scenes": [],
    }

    with pytest.raises(DirectorValidationError, match="覆盖不完整"):
        IncompleteDirector(DirectorConfig(model="fake")).validate_character_analysis(document, "人物出现。")


def test_ai_character_validation_retries_when_declared_age_fix_was_not_applied():
    class RepairDirector(OllamaTextDirector):
        def __init__(self):
            super().__init__(DirectorConfig(model="fake"))
            base = {
                "id": "role_child", "canonical_id": "role_child", "name": "孩子",
                "profile": "孩子是小学五年级学生，年龄范围为十至十一岁。",
                "profile_evidence": "文章写明小学五年级，关联文章给出十至十一岁",
                "gender": "male", "gender_evidence": "文章称其为儿子",
                "gender_basis": "current_explicit", "age_evidence": "关联文章明确写明十至十一岁",
                "age_basis": "linked_explicit",
            }
            self.responses = [
                {"all_valid": False, "summary": "年龄应保存下限", "characters": [{**base, "status": "corrected", "issues": ["年龄范围应保存下限 10"], "age": 11}]},
                {"all_valid": False, "summary": "已经落实年龄修正", "characters": [{**base, "status": "corrected", "issues": ["年龄范围应保存下限 10"], "age": 10}]},
                {"all_valid": True, "summary": "全部通过", "characters": [{**base, "status": "pass", "issues": [], "age": 10}]},
            ]

        def _request_structured(self, prompt, schema, **kwargs):
            return self.responses.pop(0), {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.1}

    document = {
        "characters": [{
            "id": "role_child", "name": "孩子", "kind": "character", "aliases": [],
            "profile": "孩子是小学五年级学生。", "voice_hint": "男童声",
            "gender": "male", "gender_evidence": "文章称其为儿子", "gender_basis": "current_explicit",
            "age": 11, "age_evidence": "小学五年级", "age_basis": "current_inference",
        }],
        "segments": [],
        "scenes": [],
    }

    report = RepairDirector().validate_character_analysis(document, "孩子是小学五年级学生。")

    assert report["round_count"] == 1
    assert report["rounds"][0]["repair_attempts"] == 1
    assert document["characters"][0]["age"] == 10


def test_ai_character_validation_reports_the_current_and_requested_age_on_no_change():
    original = {
        "id": "role_child", "name": "孩子", "profile": "孩子是小学五年级学生。",
        "gender": "male", "gender_evidence": "文章称其为儿子", "gender_basis": "current_explicit",
        "age": 11, "age_evidence": "小学五年级", "age_basis": "current_inference",
    }
    row = {
        **original, "canonical_id": "role_child", "status": "corrected",
        "issues": ["年龄约为十至十一岁，应保存下限 10，并在 age_evidence 保留完整范围"],
        "profile_evidence": "文章写明小学五年级",
    }

    inconsistencies = OllamaTextDirector._character_validation_inconsistencies([original], [row])

    assert any("age 仍为 11，issue 要求 age=10" in item for item in inconsistencies)


def test_ai_character_validation_reconciles_repeated_non_explicit_age_issues_for_inferences():
    people = [
        {
            "id": "role_002", "name": "刘至诚", "profile": "刘至诚是叙述者的高中同学。",
            "profile_evidence": "原文写明两人是高中同学", "gender": "male",
            "gender_evidence": "原文称其为丈夫", "gender_basis": "current_inference",
            "age": 25, "age_evidence": "原文写明刘至诚二十五岁结婚，据当前叙事语境推断年龄",
            "age_basis": "current_inference",
        },
        {
            "id": "role_003", "name": "欣雨", "profile": "欣雨是刘至诚的小情人。",
            "profile_evidence": "原文明确称欣雨为刘至诚的小情人", "gender": "female",
            "gender_evidence": "原文使用小情人称谓", "gender_basis": "current_inference",
            "age": 25, "age_evidence": "根据其社会关系与当前叙事语境推断为青年",
            "age_basis": "current_inference",
        },
    ]
    rows = [
        {
            **people[0], "canonical_id": "role_002", "status": "corrected",
            "issues": ["原文中并未明确提到刘至诚的年龄为25岁，仅提到他25岁就结婚，因此 age_evidence 和 age_basis 需要修正。"],
        },
        {
            **people[1], "canonical_id": "role_003", "status": "corrected",
            "issues": ["原文中并未明确提到欣雨的年龄，因此 age_evidence 和 age_basis 需要修正。"],
        },
    ]

    reconciled = OllamaTextDirector._reconcile_redundant_character_corrections(people, rows)

    assert len(reconciled) == 2
    assert all(row["status"] == "pass" for row in rows)
    assert all(row["issues"] == [] for row in rows)
    assert OllamaTextDirector._character_validation_inconsistencies(people, rows) == []


def test_ai_character_validation_reconciles_combined_non_explicit_age_and_gender_issue():
    person = {
        "id": "role_003", "name": "欣雨", "profile": "欣雨是刘至诚的小情人。",
        "profile_evidence": "原文使用小情人称谓", "gender": "female",
        "gender_evidence": "根据姓名和小情人称谓推断", "gender_basis": "current_inference",
        "age": 28, "age_evidence": "根据社会关系与当前叙事语境推断", "age_basis": "current_inference",
    }
    row = {
        **person, "canonical_id": "role_003", "status": "corrected",
        "issues": [
            "age_evidence 与原文不符，原文未明确提及年龄，但 age 字段为 28，应修正为 '未明确提及'。"
            " gender_basis 应为 'unknown'，因为原文未提供明确性别信息。"
        ],
    }

    reconciled = OllamaTextDirector._reconcile_redundant_character_corrections([person], [row])

    assert len(reconciled) == 1
    assert row["status"] == "pass"
    assert row["issues"] == []


def test_character_validation_detects_explicit_should_correct_age_target():
    original = {
        "id": "role_002", "name": "刘至诚", "profile": "刘至诚是叙述者的高中同学。",
        "gender": "male", "gender_evidence": "原文称其为丈夫", "gender_basis": "current_inference",
        "age": 30, "age_evidence": "原文提到刘至诚二十五岁结婚", "age_basis": "current_inference",
    }
    row = {
        **original, "canonical_id": "role_002", "status": "corrected",
        "issues": ["age 字段为 30，应修正为 '25岁'。"],
        "profile_evidence": "原文写明两人是高中同学",
    }

    inconsistencies = OllamaTextDirector._character_validation_inconsistencies([original], [row])

    assert any("issue 要求 age=25" in item for item in inconsistencies)


def test_ai_character_validation_downgrades_non_explicit_current_age_evidence_to_inference():
    original = {
        "id": "role_002", "name": "刘至诚", "profile": "刘至诚是叙述者的高中同学。",
        "profile_evidence": "原文写明两人是高中同学", "gender": "male",
        "gender_evidence": "原文称其为丈夫", "gender_basis": "current_inference",
        "age": 25, "age_evidence": "原文仅写明刘至诚二十五岁结婚",
        "age_basis": "current_explicit",
    }
    row = {
        **original, "canonical_id": "role_002", "status": "corrected",
        "issues": ["原文中并未明确提到刘至诚当前年龄为25岁，因此 age_evidence 和 age_basis 需要修正。"],
    }

    reconciled = OllamaTextDirector._reconcile_redundant_character_corrections([original], [row])

    assert len(reconciled) == 1
    assert row["status"] == "pass"
    assert row["issues"] == []
    assert row["age_basis"] == "current_inference"
    assert "推断值" in row["age_evidence"]
    assert "明确写明" not in row["age_evidence"]
    assert OllamaTextDirector._character_validation_inconsistencies([original], [row]) == []


def test_ai_character_validation_does_not_require_value_change_for_basis_only_issue():
    class BasisRepairDirector(OllamaTextDirector):
        def __init__(self):
            super().__init__(DirectorConfig(model="fake"))
            base = {
                "id": "role_father", "canonical_id": "role_father", "name": "父亲",
                "profile": "父亲是文章中的被害人，也是小学男生的父亲。",
                "profile_evidence": "当前文章称其为父亲，关联文章称其为被害人",
                "gender": "male", "gender_evidence": "关联文章明确称其为男性",
                "age": 52, "age_evidence": "关联文章明确写明被害人的年龄是五十二岁",
            }
            self.responses = [
                {
                    "all_valid": False,
                    "summary": "修正证据类型",
                    "characters": [{
                        **base, "status": "corrected",
                        "issues": ["age_basis 应为 linked_explicit，而非 unknown；gender_basis 应为 linked_explicit，而非 unknown"],
                        "age_basis": "linked_explicit", "gender_basis": "linked_explicit",
                    }],
                },
                {
                    "all_valid": True,
                    "summary": "全部通过",
                    "characters": [{
                        **base, "status": "pass", "issues": [],
                        "age_basis": "linked_explicit", "gender_basis": "linked_explicit",
                    }],
                },
            ]

        def _request_structured(self, prompt, schema, **kwargs):
            return self.responses.pop(0), {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.1}

    document = {
        "characters": [{
            "id": "role_father", "name": "父亲", "kind": "character", "aliases": [],
            "profile": "父亲是文章中的被害人，也是小学男生的父亲。", "voice_hint": "成年男性",
            "gender": "male", "gender_evidence": "关联文章明确称其为男性", "gender_basis": "unknown",
            "age": 52, "age_evidence": "关联文章明确写明被害人的年龄是五十二岁", "age_basis": "unknown",
        }],
        "segments": [],
        "scenes": [],
    }

    report = BasisRepairDirector().validate_character_analysis(document, "父亲的遗照由儿子抱着。")

    assert report["round_count"] == 1
    assert report["rounds"][0]["repair_attempts"] == 0
    assert document["characters"][0]["age"] == 52
    assert document["characters"][0]["age_basis"] == "linked_explicit"
    assert document["characters"][0]["gender"] == "male"
    assert document["characters"][0]["gender_basis"] == "linked_explicit"


def test_ai_character_validation_can_reclassify_a_redundant_correction_as_pass():
    class RedundantCorrectionDirector(OllamaTextDirector):
        def __init__(self):
            super().__init__(DirectorConfig(model="fake"))
            row = {
                "id": "role_child", "canonical_id": "role_child", "name": "桐原亮司",
                "profile": "桐原亮司是桐原洋介的儿子，就读小学五年级。",
                "profile_evidence": "当前文章称其为儿子并写明小学五年级",
                "gender": "male", "gender_evidence": "当前文章明确称其为儿子",
                "gender_basis": "current_explicit", "age": 10,
                "age_evidence": "关联文章写明小学五年级，年龄约为十至十一岁",
                "age_basis": "linked_explicit",
            }
            redundant = {
                "all_valid": False, "summary": "重复提出已经满足的年龄要求",
                "characters": [{
                    **row, "status": "corrected",
                    "issues": ["年龄约为十至十一岁，应保存下限 10，并在 age_evidence 保留完整范围"],
                }],
            }
            self.responses = [
                redundant,
                redundant,
                {"all_valid": True, "summary": "当前值已经满足要求", "characters": [{**row, "status": "pass", "issues": []}]},
            ]

        def _request_structured(self, prompt, schema, **kwargs):
            return self.responses.pop(0), {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.1}

    document = {
        "characters": [{
            "id": "role_child", "name": "桐原亮司", "kind": "character", "aliases": [],
            "profile": "桐原亮司是桐原洋介的儿子，就读小学五年级。", "voice_hint": "男童声",
            "profile_evidence": "当前文章称其为儿子并写明小学五年级",
            "gender": "male", "gender_evidence": "当前文章明确称其为儿子", "gender_basis": "current_explicit",
            "age": 10, "age_evidence": "关联文章写明小学五年级，年龄约为十至十一岁", "age_basis": "linked_explicit",
        }],
        "segments": [],
        "scenes": [],
    }

    report = RedundantCorrectionDirector().validate_character_analysis(document, "桐原亮司抱着父亲的遗照。")

    assert report["round_count"] == 1
    assert report["rounds"][0]["repair_attempts"] == 0
    assert report["rounds"][0]["reconciled_redundant_issues"] == [
        "role_child 的年龄目标已为 10，且 age_evidence 已保留范围"
    ]
    assert report["all_valid"] is True


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


def _write_wav(path: Path, frame_count=2205, sample_value=1):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(22050)
        output.writeframes(int(sample_value).to_bytes(2, "little", signed=True) * frame_count)


def test_segment_candidate_validator_ranks_an_emphasized_target_with_auditable_proxy(tmp_path):
    path = tmp_path / "stress.wav"
    sample_rate = 22050
    text = "一个东西引起了他的注意"
    target_center = int(sample_rate * ((text.index("他") + 0.5) / len(text)))
    samples = []
    for index in range(sample_rate):
        amplitude = 12000 if abs(index - target_center) < 1100 else 2500
        samples.append(amplitude if index % 20 < 10 else -amplitude)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"".join(int(value).to_bytes(2, "little", signed=True) for value in samples))

    metrics = analyze_segment_candidate(path, text, "他", 1)

    assert metrics["quality_passed"] is True
    assert metrics["stress_verified"] is True
    assert metrics["stress_db"] > 1.5
    assert metrics["alignment_method"] == "text_proportional_proxy_v1"


def test_advanced_stress_generation_keeps_drawing_until_three_proxy_verified_candidates(tmp_path, monkeypatch):
    demo_dir = tmp_path / "voices"
    _write_wav(demo_dir / "voice_05.wav", 100)

    class FakeModel:
        def __init__(self):
            self.calls = []

        def infer(self, **kwargs):
            self.calls.append(kwargs)
            _write_wav(Path(kwargs["output_path"]), 2205)
            return kwargs["output_path"]

        def speaker_similarity(self, reference_audio_path, candidate_audio_path):
            return 0.86

    checks = []

    def fake_candidate_check(path, text, stress_word, stress_occurrence):
        checks.append((Path(path).name, text, stress_word, stress_occurrence))
        verified = len(checks) >= 4
        return {
            "quality_passed": True,
            "score": 20.0 if verified else 8.0,
            "stress_db": 3.0 if verified else -6.0,
            "stress_verified": verified,
            "alignment_method": "text_proportional_proxy_v1",
            "duration_seconds": 0.1,
            "rms": 0.1,
            "peak": 0.2,
            "clipping_ratio": 0.0,
            "silence_ratio": 0.0,
            "target_rms": 0.15,
            "context_rms": 0.1,
        }

    monkeypatch.setattr("text_director.analyze_segment_candidate", fake_candidate_check)
    model = FakeModel()
    _, _, manifest, _ = render_directed_audio(
        document={"title": "高级重音抽卡", "content_type": "novel"},
        role_table=[_role_row()],
        segment_table=[[
            1, "正文", "narrator", "旁白", "ZH", "一个东西引起了他的注意。", "一个东西引起了他的注意。",
            "紧张警觉", "平静", 0.85, "强调", 100, "urgent_question", "急切追问", "他", 1, "strong", "advanced",
        ]],
        uploaded_files=None,
        model=model,
        model_lock=threading.Lock(),
        output_root=tmp_path / "outputs",
        project_process_dir=tmp_path / "process",
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
        advanced_segment_orders=[1],
    )

    payload = json.loads(Path(manifest).read_text(encoding="utf-8"))
    candidates = payload["segments"][0]["candidate_results"]
    assert len(model.calls) == 6
    assert len(checks) == 6
    assert len(candidates) == 3
    assert all(item["quality_passed"] and item["stress_verified"] for item in candidates)
    assert all(item["speaker_verified"] for item in candidates)
    assert all(item["speaker_validation_method"] == "campplus_cosine_v1" for item in candidates)
    assert all(item["director_verified"] is False for item in candidates)
    assert all(call["use_random"] is True for call in model.calls)
    assert 'exact text "他"' in model.calls[0]["emo_text"]


def test_advanced_regeneration_preserves_current_fragment_until_verified_candidate_is_selected(tmp_path):
    demo_dir = tmp_path / "voices"
    _write_wav(demo_dir / "voice_05.wav", 100)
    process_dir = tmp_path / "process"
    old_key = "a" * 64
    old_cache = process_dir / "segment-cache" / f"{old_key}.wav"
    _write_wav(old_cache, 100)
    (process_dir / "segment-fragments.json").write_text(json.dumps({
        "version": 1,
        "fragments": {old_key: {"order": 1, "source_text": "保留原片断。", "text": "保留原片断。"}},
    }, ensure_ascii=False), encoding="utf-8")

    class FakeModel:
        def __init__(self):
            self.calls = []

        def infer(self, **kwargs):
            self.calls.append(kwargs)
            _write_wav(Path(kwargs["output_path"]), 4410, 1000)
            return kwargs["output_path"]

        def speaker_similarity(self, reference_audio_path, candidate_audio_path):
            return 0.84

    cache_result, _, _, _ = render_directed_audio(
        document={"title": "保留现行片断", "content_type": "novel"},
        role_table=[_role_row()],
        segment_table=[[1, "正文", "narrator", "旁白", "ZH", "保留原片断。", "保留原片断。", "中性叙述", "平静", 0.7, "低声", 0, "inner_thought", "", "", 1, "none", "advanced"]],
        uploaded_files=None,
        model=FakeModel(),
        model_lock=threading.Lock(),
        output_root=tmp_path / "outputs",
        project_process_dir=process_dir,
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
        fragment_only_orders=[1],
        advanced_segment_orders=[1],
    )

    payload = json.loads((process_dir / "segment-fragments.json").read_text(encoding="utf-8"))
    fragment = payload["fragments"][Path(cache_result).stem]
    assert fragment["duration_factor"] == 1.05
    assert "沉稳舒缓" not in fragment["emotion_text"]
    assert fragment["selected_candidate_id"] == ""
    assert all(candidate["selected"] is False for candidate in fragment["candidate_results"])
    with wave.open(str(process_dir / "segment-cache" / f"{fragment['cache_key']}.wav"), "rb") as current:
        assert current.getnframes() == 100


def _role_row(role_id="narrator", name="旁白", kind="narrator", voice_id="voice_05.wav", rhythm="沉稳舒缓"):
    return [role_id, name, kind, "测试角色", "中性清晰", voice_id, rhythm, "否"]


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
    assert DIRECTOR_SCHEMA["properties"]["segments"]["items"]["properties"]["attitude"]["enum"] == sorted(ATTITUDE_PRESETS)
    assert DIRECTOR_SCHEMA["properties"]["segments"]["items"]["properties"]["pace"]["enum"] == sorted(PACE_PRESETS)
    assert "scenes" in DIRECTOR_SCHEMA["required"]
    assert {
        "title",
        "topic",
        "spatial_direction",
        "storyboard_note",
        "boundary_reason",
    } <= set(DIRECTOR_SCHEMA["properties"]["scenes"]["items"]["required"])


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


def test_news_uses_one_anchor_and_does_not_create_roles_for_quoted_people():
    source = "雨夜。李明说：“你终于来了。”"
    response = _valid_response()
    response["content_type"] = "news"
    director = FakeDirector([response])

    result = director.analyze_document(source, content_type="news")

    assert result["content_type"] == "news"
    assert result["content_type_analysis"] == {
        "requested": "news",
        "resolved": "news",
        "mode": "user_selected",
        "reason": "使用者已指定作品体裁",
        "single_anchor": True,
    }
    assert [(item["id"], item["name"], item["kind"], item["age"], item["gender"]) for item in result["characters"]] == [
        ("anchor", "主播", "anchor", None, "unspecified")
    ]
    assert {item["speaker_id"] for item in result["segments"]} == {"anchor"}
    assert all(item["speaker_confidence"] == 1 for item in result["segments"])
    assert "不建立独立角色" in director.prompts[0]
    assert "推断 gender 与 age" not in director.prompts[0]
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)


def test_auto_classification_routes_commentary_to_single_anchor_before_chunk_analysis():
    class AutoDirector(FakeDirector):
        def __init__(self, responses):
            super().__init__(responses)
            self.classification_prompts = []

        def _request_structured(self, prompt, schema, **kwargs):
            self.classification_prompts.append((prompt, kwargs["schema_name"]))
            return {
                "content_type": "commentary",
                "title": "体育明星与舆论",
                "reason": "全文以观点分析和评论为核心",
            }, {"prompt_tokens": 8, "output_tokens": 6, "duration_seconds": 0.05}

    response = _valid_response()
    response["content_type"] = "commentary"
    director = AutoDirector([response])

    result = director.analyze_document("雨夜。李明说：“你终于来了。”", content_type="auto")

    assert result["content_type"] == "commentary"
    assert result["title"] == "雨夜"
    assert result["content_type_analysis"]["mode"] == "ai_classification"
    assert result["content_type_analysis"]["reason"] == "全文以观点分析和评论为核心"
    assert result["metrics"]["classification_requests"] == 1
    assert director.classification_prompts[0][1] == "content_classification"
    assert [item["kind"] for item in result["characters"]] == ["anchor"]


def test_single_anchor_guidance_routes_every_clause_without_another_model_request():
    director = OllamaTextDirector(DirectorConfig(model="fake"))
    director._request_structured = lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("单主播不应调用 AI 路由"))
    roles = [["anchor", "主播", "anchor", "唯一主播", "中性清晰", "voice.wav", "自然叙述", "否"]]

    routing = director.resolve_guidance("语速稍慢；重点词清晰", roles)

    assert routing["model"] == "deterministic-single-anchor"
    assert [item["target_role_ids"] for item in routing["assignments"]] == [["anchor"], ["anchor"]]


def test_narrator_aliases_merge_into_one_stable_track():
    response = _valid_response()
    response["characters"][0]["name"] = "narrator"
    response["segments"][0]["speaker_name"] = "Narrator"
    director = FakeDirector([response])

    result = director.analyze_document("雨夜。李明说：“你终于来了。”", content_type="novel")

    narrators = [item for item in result["characters"] if item["kind"] == "narrator"]
    assert len(narrators) == 1
    assert {key: narrators[0][key] for key in ("id", "name", "kind", "profile", "voice_hint")} == {"id": "narrator", "name": "旁白", "kind": "narrator", "profile": "测试角色", "voice_hint": "稳定自然"}
    assert all(item["speaker_name"] == "旁白" for item in result["segments"] if item["speaker_kind"] == "narrator")


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


def test_ai_analysis_keeps_short_quoted_sign_name_inside_narrator_sentence():
    source = "笹垣没有直接走向大楼，而是在公园前右转。转角数来第五家店挂着“烤乌贼饼”的招牌，店面仅一叠大小。烤乌贼饼的台子面向马路。"
    response = {
        "content_type": "novel",
        "title": "白夜行",
        "characters": [_character()],
        "segments": [
            _segment(1, "笹垣没有直接走向大楼，而是在公园前右转。转角数来第五家店挂着", "笹垣没有直接走向大楼，而是在公园前右转。转角数来第五家店挂着"),
            _segment(2, "“烤乌贼饼”", "烤乌贼饼"),
            _segment(3, "的招牌，店面仅一叠大小。烤乌贼饼的台子面向马路。", "的招牌，店面仅一叠大小。烤乌贼饼的台子面向马路。"),
        ],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["source_text"] for item in result["segments"]] == [
        "笹垣没有直接走向大楼，而是在公园前右转。",
        "转角数来第五家店挂着“烤乌贼饼”的招牌，店面仅一叠大小。",
        "烤乌贼饼的台子面向马路。",
    ]
    assert all(item["speaker_id"] == "narrator" for item in result["segments"])
    assert result["segments"][1]["pace"] == "medium"
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)


def test_ai_analysis_keeps_short_unpunctuated_dialogue_as_character_speech():
    source = "老板娘说声“好了”，把饼递给笹垣。"
    response = {
        "content_type": "novel",
        "title": "白夜行",
        "characters": [_character(), _character("shopkeeper", "老板娘", "character")],
        "segments": [_segment(1, source, source, "shopkeeper", "老板娘", "character")],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["speaker_name"] for item in result["segments"]] == ["旁白", "老板娘", "旁白"]
    assert result["segments"][1]["source_text"] == "“好了”"
    assert result["segments"][1]["text"] == "好了"


def test_first_person_speech_attribution_does_not_create_phrase_character():
    assert OllamaTextDirector._infer_quoted_speaker("我很尊重地对她说：") == ""


def test_ai_analysis_pairs_multiple_quotes_and_distinguishes_sign_from_dialogue():
    source = "笹垣看了看写着“烤乌贼饼四十元”的牌子，付了钱。老板娘说：“多谢。”"
    response = {
        "content_type": "novel",
        "title": "白夜行",
        "characters": [_character(), _character("shopkeeper", "老板娘", "character")],
        "segments": [_segment(1, source, source)],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["source_text"] for item in result["segments"]] == [
        "笹垣看了看写着“烤乌贼饼四十元”的牌子，付了钱。",
        "老板娘说：",
        "“多谢。”",
    ]
    assert [item["speaker_name"] for item in result["segments"]] == ["旁白", "旁白", "老板娘"]
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)


@pytest.mark.parametrize(("opening", "closing"), [("‘", "’"), ("「", "」"), ("『", "』"), ('"', '"')])
def test_ai_analysis_keeps_common_inline_quote_styles(opening, closing):
    source = f"文章提到{opening}寂静之海{closing}这个标题。"
    response = {
        "content_type": "novel",
        "title": "引号",
        "characters": [_character()],
        "segments": [
            _segment(1, "文章提到", "文章提到"),
            _segment(2, f"{opening}寂静之海{closing}", "寂静之海"),
            _segment(3, "这个标题。", "这个标题。"),
        ],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["source_text"] for item in result["segments"]] == [source]
    assert result["segments"][0]["speaker_name"] == "旁白"


def test_inline_name_continuation_takes_priority_over_ambiguous_call_verb():
    source = "他叫“张三”这个名字。"
    response = {
        "content_type": "novel",
        "title": "名字",
        "characters": [_character()],
        "segments": [
            _segment(1, "他叫", "他叫"),
            _segment(2, "“张三”", "张三"),
            _segment(3, "这个名字。", "这个名字。"),
        ],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["source_text"] for item in result["segments"]] == [source]
    assert result["segments"][0]["speaker_name"] == "旁白"


def test_punctuation_only_segment_is_absorbed_into_previous_readable_segment():
    source = "第一句。第二句。"
    response = {
        "content_type": "novel",
        "title": "标点门禁",
        "characters": [_character()],
        "segments": [
            _segment(1, "第一句", "第一句"),
            _segment(2, "。", "。"),
            _segment(3, "第二句。", "第二句。"),
        ],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["source_text"] for item in result["segments"]] == ["第一句。", "第二句。"]
    assert all(any(character.isalnum() for character in item["text"]) for item in result["segments"])
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)


def test_leading_punctuation_is_absorbed_into_next_readable_segment():
    source = "……故事开始。"
    response = {
        "content_type": "novel",
        "title": "前置标点",
        "characters": [_character()],
        "segments": [
            _segment(1, "……", "……"),
            _segment(2, "故事开始。", "故事开始。"),
        ],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["source_text"] for item in result["segments"]] == [source]


def test_all_punctuation_result_is_rejected_by_segment_gate():
    response = {
        "content_type": "novel",
        "title": "无正文",
        "characters": [_character()],
        "segments": [_segment(1, "。", "。")],
    }

    director = FakeDirector([response, response])
    with pytest.raises(DirectorValidationError, match="只有标点"):
        director.analyze_document("。", content_type="novel")


def test_pre_split_unpunctuated_dialogue_inherits_profile_alias_speaker():
    source = "充分加热后，老板娘包好饼，说声“好了”，把饼递给笹垣。"
    shopkeeper = {
        **_character("shopkeeper", "中年妇人", "character"),
        "profile": "经营店铺的老板娘，热情招待顾客。",
    }
    response = {
        "content_type": "novel",
        "title": "白夜行",
        "characters": [_character(), shopkeeper],
        "segments": [
            _segment(1, "充分加热后，老板娘包好饼，说声", "充分加热后，老板娘包好饼，说声"),
            _segment(2, "“好了”", "好了"),
            _segment(3, "，把饼递给笹垣。", "，把饼递给笹垣。"),
        ],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["speaker_name"] for item in result["segments"]] == ["旁白", "中年妇人", "旁白"]
    assert result["segments"][1]["source_text"] == "“好了”"


def test_embedded_dialogue_uses_profile_alias_without_creating_adverb_role():
    source = "老板娘亲切地说：“多谢。”"
    shopkeeper = {
        **_character("shopkeeper", "中年妇人", "character"),
        "profile": "经营店铺的老板娘，热情招待顾客。",
    }
    response = {
        "content_type": "novel",
        "title": "白夜行",
        "characters": [_character(), shopkeeper],
        "segments": [_segment(1, source, source)],
    }

    result = FakeDirector([response]).analyze_document(source, content_type="novel")

    assert [item["speaker_name"] for item in result["segments"]] == ["旁白", "中年妇人"]
    assert all(item["name"] != "老板娘亲切地" for item in result["characters"])


def test_ai_analysis_falls_back_after_two_incomplete_results():
    invalid = _valid_response()
    invalid["segments"] = [invalid["segments"][1]]
    director = FakeDirector([invalid, invalid])

    source = "雨夜。李明说：“你终于来了。”"
    result = director.analyze_document(source, content_type="novel")

    assert result["metrics"]["fallback_chunks"] == 1
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)


def test_timeout_is_not_repeated_for_the_same_large_chunk():
    class TimeoutDirector(OllamaTextDirector):
        calls = 0

        def _chat(self, prompt):
            self.calls += 1
            raise DirectorTimeout("测试超时")

    director = TimeoutDirector(DirectorConfig(model="fake"))
    with pytest.raises(DirectorTimeout, match="测试超时"):
        director._analyze_chunk(
            chunk="长文本。" * 100,
            chunk_index=1,
            chunk_count=1,
            requested_type="story",
            existing_characters=[],
            previous_context="",
            guidance="",
        )

    assert director.calls == 1


def test_product_chunk_policy_does_not_repeat_an_invalid_same_size_request():
    class OneAttemptDirector(OllamaTextDirector):
        calls = 0

        def _chat(self, prompt):
            self.calls += 1
            invalid = _valid_response()
            invalid["segments"] = []
            return invalid, {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.01}

    director = OneAttemptDirector(DirectorConfig(model="fake", chunk_validation_attempts=1))
    with pytest.raises(DirectorValidationError, match="1 次尝试"):
        director._analyze_chunk(
            chunk="需要重新拆分的文本。",
            chunk_index=1,
            chunk_count=1,
            requested_type="story",
            existing_characters=[],
            previous_context="",
            guidance="",
        )

    assert director.calls == 1


def test_long_document_adaptively_splits_timed_out_chunks():
    class AdaptiveDirector(OllamaTextDirector):
        attempted_lengths = []

        def _analyze_chunk(self, *, chunk, **kwargs):
            self.attempted_lengths.append(len(chunk))
            if len(chunk) > 700:
                raise DirectorTimeout("块过大")
            return (
                {
                    "content_type": "story",
                    "title": "长篇测试",
                    "characters": [_character()],
                    "segments": [_segment(1, chunk, chunk)],
                },
                {"prompt_tokens": 10, "output_tokens": 20, "duration_seconds": 0.1},
            )

    source = "很久以前，故事仍在继续。" * 180
    director = AdaptiveDirector(DirectorConfig(model="fake", max_chunk_chars=1400))
    progress_messages = []
    result = director.analyze_document(
        source,
        content_type="story",
        progress=lambda fraction, desc="": progress_messages.append(desc),
    )

    assert any(length > 700 for length in director.attempted_lengths)
    assert result["metrics"]["chunks"] >= 4
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)
    assert any("超时" in message and "拆" in message for message in progress_messages)


def test_long_document_adaptively_splits_coverage_failures():
    class CoverageDirector(OllamaTextDirector):
        attempted_lengths = []

        def _analyze_chunk(self, *, chunk, **kwargs):
            self.attempted_lengths.append(len(chunk))
            if len(chunk) > 320:
                raise DirectorValidationError("source_text 未完整覆盖本次原文")
            return (
                {
                    "content_type": "novel",
                    "title": "覆盖测试",
                    "characters": [_character()],
                    "segments": [_segment(1, chunk, chunk)],
                },
                {"prompt_tokens": 5, "output_tokens": 10, "duration_seconds": 0.05},
            )

    source = "林舟沿着长街继续前行，仔细记下沿途的每一个细节。" * 100
    director = CoverageDirector(DirectorConfig(model="fake", max_chunk_chars=1400))
    progress_updates = []
    result = director.analyze_document(
        source,
        content_type="novel",
        progress=lambda fraction, desc="": progress_updates.append((fraction, desc)),
    )

    assert max(director.attempted_lengths) > 320
    assert result["metrics"]["chunks"] > 4
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)
    assert any("覆盖校验失败" in message and "拆" in message for _, message in progress_updates)
    chunk_fractions = [fraction for fraction, message in progress_updates if "逐段解析第" in message]
    assert chunk_fractions == sorted(chunk_fractions)


def test_real_validation_retry_chain_subdivides_until_coverage_passes():
    class ValidationChainDirector(OllamaTextDirector):
        attempted_lengths = []

        def _chat(self, prompt):
            chunk = prompt.split("<<<SOURCE\n", 1)[1].split("\nSOURCE", 1)[0]
            self.attempted_lengths.append(len(chunk))
            returned = chunk if len(chunk) <= 320 else chunk[:-1]
            return (
                {
                    "content_type": "story",
                    "title": "自动细分",
                    "characters": [_character()],
                    "segments": [_segment(1, returned, returned)],
                },
                {"prompt_tokens": 5, "output_tokens": 10, "duration_seconds": 0.05},
            )

    source = "港口的灯光沿着海面缓慢移动，林舟认真核对航海日志。" * 40
    director = ValidationChainDirector(DirectorConfig(model="fake", max_chunk_chars=1400))
    result = director.analyze_document(source, content_type="story")

    large_lengths = [length for length in director.attempted_lengths if length > 320]
    assert large_lengths
    assert all(director.attempted_lengths.count(length) >= 2 for length in set(large_lengths))
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)


def test_exact_sentence_slices_preserve_quotes_whitespace_and_newlines():
    source = "第一句。\n\n林舟问：“现在走吗？”  最后一行没有句号"
    slices = split_exact_sentences(source)

    assert "".join(slices) == source
    assert len(slices) == 3


def test_minimum_failed_chunk_uses_lossless_fallback_and_continues():
    class AlwaysInvalidDirector(OllamaTextDirector):
        def _analyze_chunk(self, **kwargs):
            raise DirectorValidationError("source_text 未完整覆盖本次原文")

    source = "雨停了。林舟说：“我们继续走。”\n下一段仍然完整保留。"
    messages = []
    director = AlwaysInvalidDirector(DirectorConfig(model="fake", max_chunk_chars=1400))
    result = director.analyze_document(
        source,
        content_type="story",
        progress=lambda fraction, desc="": messages.append(desc),
    )

    assert result["metrics"]["fallback_chunks"] == 1
    assert coverage_key("".join(item["source_text"] for item in result["segments"])) == coverage_key(source)
    assert any("无损安全分段" in message for message in messages)
    assert any(character["name"] == "林舟" for character in result["characters"])


def test_chapter_sections_use_formal_source_boundaries_and_compact_numbers():
    source = "第一章 雨夜\n甲。\n第二章 天明\n乙。"
    assigned = assign_numbered_chapter_sections(source, [
        {**_segment(1, "甲。", "甲。"), "section": "甲的完整台词"},
        {**_segment(2, "乙。", "乙。"), "section": "乙的完整台词"},
    ])

    assert [item["section"] for item in assigned] == ["第 1 章", "第 2 章"]
    assert [item["source_text"] for item in assigned] == ["甲。", "乙。"]


def test_analyze_document_overrides_model_generated_sentence_sections():
    class SentenceSectionDirector(OllamaTextDirector):
        def _analyze_chunk(self, **kwargs):
            chunk = kwargs["chunk"]
            midpoint = chunk.index("第二章")
            return ({
                "content_type": "novel",
                "title": "编号测试",
                "characters": [_character()],
                "scenes": [],
                "segments": [
                    {**_segment(1, chunk[:midpoint], chunk[:midpoint]), "section": chunk[:midpoint].strip()},
                    {**_segment(2, chunk[midpoint:], chunk[midpoint:]), "section": chunk[midpoint:].strip()},
                ],
            }, {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.01})

    source = "第一章\n甲。\n第二章\n乙。"
    result = SentenceSectionDirector(DirectorConfig(model="fake", max_chunk_chars=1400)).analyze_document(source, content_type="novel")
    _, rows = document_to_tables(result, ["voice_05.wav"])

    assert [item["section"] for item in result["segments"]] == ["第 1 章", "第 2 章"]
    assert [row[1] for row in rows] == ["第 1 章", "第 2 章"]


def test_adaptive_chunks_keep_closing_quotes_with_their_sentence_boundary():
    source = "甲" * 180 + "？”" + "乙" * 180

    chunks = split_document(source, 320)

    assert "".join(chunks) == source
    assert chunks[0].endswith("？”")
    assert chunks[1].startswith("乙")


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
    assert "停连" in roles["narrator"]["rhythm_prompt"]
    assert segments[1]["speaker_id"] == "role_001"
    assert segments[1]["attitude_preset"] == "中性叙述"
    assert segments[1]["emotion_label"] == "平静"
    assert segments[1]["emotion_direction"] == "auto"
    assert segment_rows[1][12:] == ["auto", "", "", 1, "none", "standard"]


def test_legacy_natural_language_directing_values_migrate_to_presets():
    assert migrate_rhythm_preset("沉稳从容，韵母自然舒展，停连清晰") == "沉稳舒缓"
    assert migrate_rhythm_preset("轻快灵动，短句间自然换气") == "轻快活泼"
    assert migrate_pace_preset("短语间停连清晰，整体舒缓") == "舒缓"
    assert migrate_attitude_preset("平静叙述") == "中性叙述"
    assert migrate_emotion_label("melancholic") == "低落"
    migrated = migrate_segment_rows([[1, "正文", "narrator", "旁白", "ZH", "原文", "原文", "中性叙述", "平静", 0.5, "自然", 300]])
    assert migrated[0][12:] == ["auto", "", "", 1, "none", "standard"]
    assert EMOTION_DIRECTION_PRESETS["sly_smile"][2] == 0.8


def test_product_level_ai_attitude_and_pace_presets_survive_document_conversion():
    document = {
        "characters": [_character()],
        "segments": [{**_segment(1, "请注意。", "请注意。"), "attitude": "威严命令", "pace": "强调"}],
    }
    normalized = OllamaTextDirector(DirectorConfig())._validate_chunk({"content_type": "novel", "title": "预设", **document}, "请注意。")
    _, rows = document_to_tables(normalized, ["voice_05.wav"])
    assert rows[0][7] == "威严命令"
    assert rows[0][10] == "强调"


def test_unknown_limited_presets_are_rejected_but_voice_design_accepts_native_prompt():
    document = {
        "characters": [_character()],
        "segments": [_segment(1, "测试。", "测试。")],
    }
    role_rows = [["narrator", "旁白", "narrator", "成熟", "五十岁女声，略带沙哑", "voice_05.wav", "自然叙述", "是"]]
    guidance = "悬疑故事，人物对白克制"
    routing = {"guidance": guidance, "role_signature": guidance_role_signature(role_rows), "assignments": [{"instruction": "悬疑故事", "target_role_ids": ["narrator"]}]}
    jobs = build_voice_design_jobs(document, role_rows, {"content_type": "story", "guidance": guidance, "guidance_routing": routing})
    assert "五十岁女声，略带沙哑" in jobs[0]["instruct"]
    assert "作品体裁：故事体" in jobs[0]["instruct"]
    assert "本角色有效导演上下文：悬疑故事" in jobs[0]["instruct"]
    assert "人物对白克制" not in jobs[0]["instruct"]
    assert "人物小传：成熟" in jobs[0]["instruct"]
    assert "声音导演：五十岁女声，略带沙哑" in jobs[0]["instruct"]
    assert jobs[0]["instruct"].startswith("首要声音身份：必须由约 35 岁女性自然发声")
    assert "旁白旁白" not in jobs[0]["instruct"]

    invalid_roles = [list(role_rows[0])]
    invalid_roles[0][6] = "随便慢一点"
    segment_rows = [[1, "正文", "narrator", "旁白", "ZH", "测试。", "测试。", "中性叙述", "平静", 0.5, "自然", 0]]
    with pytest.raises(DirectorError, match="未知角色节奏预设"):
        tables_to_script(invalid_roles, segment_rows)

    for index, value, message in ((7, "自行发挥", "未知态度预设"), (8, "惆怅", "未知情绪预设"), (10, "拖慢", "未知句内节奏预设")):
        invalid_segments = [list(segment_rows[0])]
        invalid_segments[0][index] = value
        with pytest.raises(DirectorError, match=message):
            tables_to_script(role_rows, invalid_segments)


def test_voice_design_jobs_include_explicit_character_age_and_pitch_target():
    document = {
        "content_type": "novel",
        "characters": [_character("role_001", "林澈", "character")],
        "segments": [_segment(1, "测试。", "测试。", role_id="role_001", name="林澈", kind="character")],
    }
    roles = [["role_001", "林澈", "character", "三十五岁的刑警，性格克制。", "低沉厚实", "voice.wav", "自然叙述", "是"]]
    context = {
        "content_type": "novel",
        "character_assets": {"role_001": {"gender": "male", "age": 35, "pitch_min_hz": 85, "pitch_max_hz": 180, "pitch_target_hz": 105, "audition_text": "林澈正在检查现场。", "voice_traits": {"weight": 80, "brightness": 20, "resonance": 10}, "voice_generation": {"preset": "custom", "temperature": 1.2, "top_k": 88, "candidate_count": 4, "seed": 99}}},
    }
    job = build_voice_design_jobs(document, roles, context)[0]
    assert job["expected_gender"] == "male"
    assert job["character_age"] == 35
    assert job["pitch_target_hz"] == 105
    assert "建议基频区间：85 至 180 Hz" in job["instruct"]
    assert "目标基频中位数约 105 Hz" in job["instruct"]
    assert "只接受落盘复测进入目标容差的原始自然声音" in job["instruct"]
    assert job["pitch_calibration_version"] == 6
    assert "年龄听感强约束" in job["instruct"]
    assert "声音重量非常厚重" in job["instruct"]
    assert "音色亮度偏暗" in job["instruct"]
    assert job["text"] == "林澈正在检查现场。"
    assert job["voice_generation"]["temperature"] == 1.2
    assert job["voice_generation"]["top_k"] == 88
    assert job["voice_generation"]["candidate_count"] == 4
    assert job["seed"] == 99


def test_child_voice_design_uses_an_unambiguous_pre_voice_change_constraint():
    document = {"characters": [_character("role_child", "小宇", "character")], "segments": [_segment(1, "测试。", "测试。", role_id="role_child", name="小宇", kind="character")]}
    roles = [["role_child", "小宇", "character", "十岁男孩", "清亮年轻", "", "自然叙述", "是"]]
    job = build_voice_design_jobs(document, roles, {"character_assets": {"role_child": {"gender": "male", "age": 10, "pitch_min_hz": 190, "pitch_max_hz": 320, "pitch_target_hz": 230}}})[0]
    assert job["instruct"].startswith("一个 10 岁的小学生男孩，使用尚未变声的自然男童童声说话")
    assert "性别身份比音高更重要" in job["instruct"]
    assert "声音稚嫩、轻巧" in job["instruct"]
    assert "声音基频中位数自然保持在 190 至 320 Hz，目标约 230 Hz" in job["instruct"]
    assert "人物小传" not in job["instruct"]
    assert "成年男性" not in job["instruct"]
    assert "男性胸腔共鸣" not in job["instruct"]
    assert job["text"] == "我是一个10岁的男孩，刚从学校回来。你找我有什么事吗？"


def test_japanese_child_voice_design_uses_gender_anchored_audition_text():
    segment = _segment(1, "僕は帰った。", "僕は帰った。", role_id="role_child", name="桐原亮", kind="character")
    segment["language"] = "JA"
    document = {"characters": [_character("role_child", "桐原亮", "character")], "segments": [segment]}
    roles = [["role_child", "桐原亮", "character", "十岁男孩", "沉默的男孩声音", "", "自然叙述", "是"]]
    job = build_voice_design_jobs(document, roles, {"character_assets": {"role_child": {"gender": "male", "age": 10, "pitch_min_hz": 190, "pitch_max_hz": 320, "pitch_target_hz": 255}}})[0]
    assert job["language"] == "Japanese"
    assert job["text"].startswith("僕は10歳の男の子です")


def test_child_voice_design_translates_low_tone_words_into_child_safe_emotion():
    document = {"characters": [_character("role_child", "小亮", "character")], "segments": [_segment(1, "测试。", "测试。", role_id="role_child", name="小亮", kind="character")]}
    roles = [["role_child", "小亮", "character", "十岁男孩，情绪阴沉压抑。", "低沉而沉默的男孩声音", "", "沉稳舒缓", "是"]]
    job = build_voice_design_jobs(document, roles, {"character_assets": {"role_child": {"gender": "male", "age": 10, "pitch_min_hz": 190, "pitch_max_hz": 320, "pitch_target_hz": 255}}})[0]
    assert "情绪安静克制，带轻微低落感" in job["instruct"]
    assert "低沉" not in job["instruct"]
    assert "沉稳舒缓" not in job["instruct"]


def test_voice_design_jobs_preserve_structured_guidance_sources_and_add_mature_timbre_constraints():
    roles = [["role_003", "教授", "character", "法医学专家", "老年男性音色", "", "自然叙述", "是"]]
    routing = {
        "guidance": "教授声音低沉",
        "role_signature": guidance_role_signature(roles),
        "assignments": [{"source_text": "教授声音低沉", "instruction": "声音低沉", "target_role_ids": ["role_003"]}],
    }
    document = {
        "characters": [_character("role_003", "教授", "character")],
        "segments": [_segment(1, "测试。", "测试。", role_id="role_003", name="教授", kind="character")],
        "guidance_routing": routing,
    }
    job = build_voice_design_jobs(document, roles, {"guidance": "教授声音低沉", "guidance_routing": routing, "character_assets": {"role_003": {"gender": "male", "age": 55, "pitch_min_hz": 85, "pitch_max_hz": 180, "pitch_target_hz": 117}}})[0]

    assert job["effective_guidance_sources"] == ["教授声音低沉"]
    assert job["effective_guidance_instructions"] == ["声音低沉"]
    assert "成熟偏老年声线" in job["instruct"]
    assert "禁止明亮、轻薄、紧致的青年声线" in job["instruct"]


def test_ai_routed_guidance_excludes_narrator_voice_from_characters_and_enforces_gender():
    document = {
        "characters": [_character(), _character("role_002", "老板娘", "character")],
        "segments": [_segment(1, "好，来了。", "好，来了。", "role_002", "老板娘", "character")],
    }
    roles = [
        ["narrator", "旁白", "narrator", "全篇叙事", "成熟男声", "voice_05.wav", "沉稳舒缓", "是"],
        ["role_002", "老板娘", "character", "五十岁左右的胖女人", "中年女性音色，语调温和", "voice_06.wav", "自然叙述", "是"],
    ]
    guidance = "旁白缓慢而深沉，老年男性音色。作品整体保持克制。"
    routing = {
        "guidance": guidance,
        "role_signature": guidance_role_signature(roles),
        "assignments": [
            {"instruction": "旁白缓慢而深沉；老年男性音色", "target_role_ids": ["narrator"]},
            {"instruction": "作品整体保持克制", "target_role_ids": ["narrator", "role_002"]},
        ],
    }
    jobs = build_voice_design_jobs(document, roles, {"content_type": "novel", "guidance": guidance, "guidance_routing": routing})
    narrator, owner = jobs

    assert "老年男性音色" in narrator["instruct"]
    assert "作品整体保持克制" in narrator["instruct"]
    assert narrator["expected_gender"] == "male"
    assert "老年男性音色" not in owner["instruct"]
    assert "本角色有效导演上下文：作品整体保持克制" in owner["instruct"]
    assert owner["instruct"].startswith("首要声音身份：必须由约 35 岁女性自然发声")
    assert owner["instruct"].endswith("最终确认：输出必须保持自然、明确、可听辨的女性声音。")
    assert owner["expected_gender"] == "female"
    assert infer_voice_gender("中年女性音色", "", "") == "female"


def test_ai_guidance_router_resolves_inherited_and_global_targets(monkeypatch):
    roles = [
        ["narrator", "旁白", "narrator", "全篇叙事", "成熟声线", "voice_05.wav", "沉稳舒缓", "是"],
        ["role_001", "笹垣润三", "character", "负责调查的刑警", "中年男性音色", "voice_04.wav", "自然叙述", "是"],
    ]
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"message": {"content": json.dumps({"assignments": [
                {"clause_index": 1, "scope": "roles", "target_role_ids": ["narrator"], "instruction": "旁白缓慢而深沉", "reason": "明确点名旁白"},
                {"clause_index": 2, "scope": "roles", "target_role_ids": ["narrator"], "instruction": "旁白使用老年男性音色", "reason": "承接上一片段的旁白目标"},
                {"clause_index": 3, "scope": "global", "target_role_ids": [], "instruction": "作品整体保持克制", "reason": "作品级要求"},
            ]}, ensure_ascii=False)}}

    def fake_post(url, json, timeout):
        captured.update({"url": url, "body": json, "timeout": timeout})
        return FakeResponse()

    monkeypatch.setattr("text_director.requests.post", fake_post)
    routing = OllamaTextDirector(DirectorConfig()).resolve_guidance("旁白缓慢而深沉，老年男性音色。作品整体保持克制。", roles)

    assert captured["body"]["keep_alive"] == "30m"
    assert captured["body"]["options"]["num_ctx"] == 8192
    assert captured["body"]["format"]["properties"]["assignments"]
    assert routing["role_signature"] == guidance_role_signature(roles)
    assert routing["assignments"][0]["target_role_names"] == ["旁白"]
    assert routing["assignments"][1]["target_role_ids"] == ["narrator"]
    assert routing["assignments"][2]["target_role_ids"] == ["narrator", "role_001"]


def test_guidance_router_validator_rejects_global_scope_for_an_explicit_role():
    roster = [
        {"role_id": "narrator", "name": "旁白", "kind": "narrator", "profile": "叙事", "voice_hint": "稳定"},
        {"role_id": "role_001", "name": "笹垣润三", "kind": "character", "profile": "刑警", "voice_hint": "男声"},
    ]
    raw = {"assignments": [{"clause_index": 1, "scope": "global", "target_role_ids": [], "instruction": "旁白缓慢", "reason": "错误地扩大范围"}]}
    with pytest.raises(DirectorValidationError, match="不能分配为 global"):
        validate_guidance_assignments(raw, ["旁白缓慢"], roster)


def test_director_prompt_keeps_detailed_biography_out_of_the_segmentation_budget():
    director = OllamaTextDirector(DirectorConfig())
    prompt = director._build_prompt(
        chunk="笹垣是负责案件调查的刑警。",
        chunk_index=1,
        chunk_count=1,
        requested_type="novel",
        existing_characters=[],
        previous_context="",
        guidance="旁白克制",
    )
    assert "profile 在本阶段只写 40 到 120 个中文字符" in prompt
    assert "详细人物小传由独立功能扩写" in prompt
    assert "speaker_candidates" in prompt
    assert "全文场景注册表" in prompt
    assert "内容主题变化" in prompt
    assert "人物方位、观察方向或叙事焦点" in prompt
    assert "storyboard_note 使用 80 到 220 个中文字符" in prompt
    assert "voice_hint 是声音导演建议" in prompt
    assert "音高、共鸣位置、气息、吐字方式和基础情绪" in prompt
    assert "根据角色内容选择" in prompt
    assert "句内短引用" in prompt
    assert "烤乌贼饼" in prompt
    assert "人物对白、心理活动、句内引用或普通叙述" in prompt
    assert "相邻句、人物表和说话动作" in prompt
    assert "纯标点" in prompt
    assert "必须包含可朗读文字" in prompt


def test_compatible_chat_completions_uses_structured_output_without_exposing_credentials(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": json.dumps(_valid_response(), ensure_ascii=False)}}], "usage": {"prompt_tokens": 12, "completion_tokens": 34}}

    def fake_post(url, **kwargs):
        captured.update({"url": url, **kwargs})
        return FakeResponse()

    monkeypatch.setattr("text_director.requests.post", fake_post)
    director = OllamaTextDirector(DirectorConfig(provider="compatible", base_url="https://ai.example/v1", api_key="secret", instance_id=".director-agent", model="gpt-test"))
    result, metrics = director._chat("测试")

    assert result["title"] == "雨夜"
    assert captured["url"] == "https://ai.example/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer secret"
    assert captured["headers"]["X-Cockpit-Instance-Id"] == ".director-agent"
    assert captured["json"]["response_format"]["type"] == "json_schema"
    assert captured["json"]["response_format"]["json_schema"]["strict"] is True
    assert metrics["prompt_tokens"] == 12
    assert metrics["output_tokens"] == 34


def test_compatible_responses_uses_strict_structured_output_and_instance_header(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": json.dumps(_valid_response(), ensure_ascii=False), "usage": {"input_tokens": 21, "output_tokens": 55}}

    def fake_post(url, **kwargs):
        captured.update({"url": url, **kwargs})
        return FakeResponse()

    monkeypatch.setattr("text_director.requests.post", fake_post)
    director = OllamaTextDirector(DirectorConfig(provider="compatible", base_url="https://ai.example/v1", api_key="secret", instance_id=".director-agent", text_api="responses", model="gpt-test"))
    result, metrics = director._chat("测试")

    assert result["title"] == "雨夜"
    assert captured["url"] == "https://ai.example/v1/responses"
    assert captured["headers"]["X-Cockpit-Instance-Id"] == ".director-agent"
    assert captured["json"]["text"]["format"]["type"] == "json_schema"
    assert captured["json"]["text"]["format"]["strict"] is True
    assert metrics["prompt_tokens"] == 21
    assert metrics["output_tokens"] == 55


def test_staged_analysis_builds_global_role_alias_and_scene_registry_before_segments():
    class StagedDirector(OllamaTextDirector):
        chunk_prompts = []

        def _request_structured(self, prompt, schema, **kwargs):
            if kwargs["schema_name"] == "gender_suggestion":
                return ({
                    "suggestions": [{"id": "narrator", "gender": "female", "evidence": "适合作品的女性旁白声音建议"}],
                }, {"prompt_tokens": 4, "output_tokens": 3, "duration_seconds": 0.02})
            assert kwargs["schema_name"] == "director_context"
            return ({
                "content_type": "novel",
                "title": "白夜行",
                "characters": [
                    {**_character(), "aliases": ["叙述者"], "confidence": 1, "evidence": "叙事文本"},
                    {**_character("local-owner", "中年妇人", "character"), "aliases": ["老板娘", "胖女人"], "confidence": 0.92, "evidence": "老板娘说"},
                ],
                "scenes": [{"id": "local-scene", "location": "小吃店", "time": "傍晚", "participants": ["local-owner"], "narrative_perspective": "第三人称", "mood": "克制", "evidence": "店内对话"}],
            }, {"prompt_tokens": 20, "output_tokens": 30, "duration_seconds": 0.2})

        def _chat_staged(self, prompt):
            self.chunk_prompts.append(prompt)
            response = _valid_response()
            response["characters"][1] = _character("shopkeeper", "老板娘", "character")
            response["segments"][1]["speaker_id"] = "shopkeeper"
            response["segments"][1]["speaker_name"] = "老板娘"
            response["segments"][2]["speaker_id"] = "shopkeeper"
            response["segments"][2]["speaker_name"] = "老板娘"
            response["scenes"] = [{"id": "scene_001", "location": "小吃店", "time": "傍晚", "participants": ["shopkeeper"], "narrative_perspective": "第三人称", "mood": "克制", "evidence": "店内对话"}]
            for segment in response["segments"]:
                segment["scene_id"] = "scene_001"
            return {
                "characters": [],
                "scenes": [],
                "segments": [
                    {
                        "i": index,
                            "s": "role_001" if item["speaker_id"] == "shopkeeper" else item["speaker_id"],
                        "c": item.get("speaker_candidates", [item["speaker_id"]]),
                        "q": item.get("speaker_confidence", 1),
                        "e": item.get("speaker_evidence", "测试说话归属"),
                        "g": item["scene_id"],
                        "l": item["language"],
                        "a": item["attitude"],
                        "m": item["emotion"],
                        "v": item["intensity"],
                        "p": item["pace"],
                        "d": item["pause_after_ms"],
                    }
                    for index, item in enumerate(response["segments"][:2], start=1)
                ],
            }, {"prompt_tokens": 10, "output_tokens": 20, "duration_seconds": 0.1}

    result = StagedDirector(DirectorConfig(model="fake", staged_analysis=True)).analyze_document("雨夜。老板娘说：“你终于来了。”", content_type="novel")

    owner = next(item for item in result["characters"] if item["name"] == "中年妇人")
    assert "老板娘" in owner["aliases"]
    assert result["scenes"][0]["location"] == "小吃店"
    assert result["scenes"][0]["start_segment_order"] == 1
    assert result["scenes"][0]["end_segment_order"] == len(result["segments"])
    assert result["metrics"]["context_requests"] == 1
    assert result["metrics"]["context_fallback"] == 0
    assert result["content_type"] == "novel"
    assert "segments 使用紧凑字段" in StagedDirector.chunk_prompts[0]
    assert "JSON Schema：" not in StagedDirector.chunk_prompts[0]


def test_scene_ranges_follow_actual_segment_assignments_and_drop_unused_registry_rows():
    scenes = [
        OllamaTextDirector._normalize_scene({"id": "scene_001", "title": "门外", "topic": "抵达", "location": "门外"}, 1),
        OllamaTextDirector._normalize_scene({"id": "scene_002", "title": "室内", "topic": "会面", "location": "客厅"}, 2),
        OllamaTextDirector._normalize_scene({"id": "scene_003", "title": "未采用", "topic": "旧注册", "location": "阁楼"}, 3),
    ]
    segments = [
        {"order": 1, "scene_id": "scene_001"},
        {"order": 2, "scene_id": "scene_001"},
        {"order": 3, "scene_id": "scene_002"},
    ]

    finalized = OllamaTextDirector._finalize_scene_ranges(scenes, segments)

    assert [scene["id"] for scene in finalized] == ["scene_001", "scene_002"]
    assert (finalized[0]["start_segment_order"], finalized[0]["end_segment_order"]) == (1, 2)
    assert (finalized[1]["start_segment_order"], finalized[1]["end_segment_order"]) == (3, 3)


def test_quoted_speaker_inference_does_not_treat_low_voice_as_a_name():
    assert OllamaTextDirector._infer_quoted_speaker("林澈握紧信封，低声说：") == "林澈"
    assert OllamaTextDirector._infer_quoted_speaker("中冢抬起头，冷冷地问：") == "中冢"


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

    assert rows[0][5] == "voice_05.wav"
    assert rows[1][5] == "voice_09.wav"
    assert rows[2][5] == "voice_11.wav"
    assert all(row[5] not in {"voice_01.wav", "voice_02.wav"} for row in rows)
    assert len({row[6] for row in rows}) > 1


def test_voice_design_jobs_and_generated_voice_mapping(tmp_path):
    document = {
        "characters": [_character(), _character("role_001", "李 明", "character")],
        "segments": [_segment(1, "你好。", "你好。", "role_001", "李 明", "character")],
    }
    roles = [
        ["narrator", "旁白", "narrator", "成熟稳重", "厚实沉稳", "voice_05.wav", "沉稳舒缓", "是"],
        ["role_001", "李 明", "character", "年轻明亮", "清澈明亮", "voice_09.wav", "轻快活泼", "是"],
    ]
    jobs = build_voice_design_jobs(document, roles)
    generated_path = tmp_path / jobs[1]["filename"]
    generated_path.touch()
    updated = apply_generated_voices(roles, [{"role_id": "role_001", "path": str(generated_path)}])

    assert jobs[0]["language"] == "Chinese"
    assert "旁白" in jobs[0]["instruct"]
    assert jobs[1]["filename"].endswith(".wav")
    assert " " not in jobs[1]["filename"]
    assert updated[1][5] == generated_path.name
    assert updated[1][7] == "否"


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
        _role_row(),
        _role_row("role_001", "李明", "character", "voice_01.wav", "克制停连"),
    ]
    segment_rows = [
        [1, "开场", "narrator", "旁白", "ZH", "雨夜。", "雨夜。", "克制低沉", "平静", 0.5, "舒缓", 200],
        [2, "开场", "role_001", "李明", "ZH", "你好。", "你好。", "紧张警觉", "恐惧", 0.7, "紧凑", 300],
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
    assert len(list((Path(master).parent / "chapters").glob("*.wav"))) == 1
    assert (Path(master).parent / "director-script.csv").is_file()
    assert "2 条分句" in status
    assert "2 个角色配置、2 个有内容的角色轨道" in status
    assert model.calls[0]["emo_text"].endswith("克制、低沉地表达。平静。")
    assert "韵母自然舒展" in model.calls[0]["emo_text"]
    assert model.calls[0]["duration_factor"] == 1.18
    assert "沉稳舒缓" not in model.calls[0]["emo_text"]
    with zipfile.ZipFile(package) as archive:
        names = set(archive.namelist())
        assert "full-audio.wav" in names
        assert "director-manifest.json" in names
        assert "director-script.csv" in names
        assert any(name.startswith("chapters/") for name in names)
    payload = json.loads(Path(manifest).read_text(encoding="utf-8"))
    assert payload["roles"][0]["voice_id"] == "voice_05.wav"


def test_render_resolves_current_role_voice_from_library_without_project_voice_files(tmp_path):
    demo_dir = tmp_path / "examples"
    demo_dir.mkdir()
    voice_library = tmp_path / "voice-library"
    current_voice = voice_library / "voice-current.wav"
    _write_wav(current_voice, 100)

    class FakeModel:
        calls = []

        def infer(self, **kwargs):
            self.calls.append(kwargs)
            _write_wav(Path(kwargs["output_path"]), 2205)
            return kwargs["output_path"]

    segments = [[1, "正文", "narrator", "旁白", "ZH", "测试。", "测试。", "中性叙述", "平静", 0.5, "自然", 0]]
    model = FakeModel()
    render_directed_audio(
        document={"title": "角色音色动态解析", "content_type": "novel"},
        role_table=[_role_row(voice_id="voice-current")],
        segment_table=segments,
        uploaded_files=[],
        model=model,
        model_lock=threading.Lock(),
        output_root=tmp_path / "outputs",
        demo_dir=demo_dir,
        demo_voices={},
        voice_library_dir=voice_library,
    )

    assert model.calls[0]["spk_audio_prompt"] == str(current_voice.resolve())
    assert segments[0][2] == "narrator"


def test_missing_current_role_voice_reports_only_role_and_expected_path(tmp_path):
    with pytest.raises(DirectorError) as raised:
        render_directed_audio(
            document={"title": "缺失音色", "content_type": "novel"},
            role_table=[_role_row(voice_id="voice-missing")],
            segment_table=[[1, "正文", "narrator", "旁白", "ZH", "测试。", "测试。", "中性叙述", "平静", 0.5, "自然", 0]],
            uploaded_files=[],
            model=object(),
            model_lock=threading.Lock(),
            output_root=tmp_path / "outputs",
            demo_dir=tmp_path / "examples",
            demo_voices={},
            voice_library_dir=tmp_path / "voice-library",
        )

    message = str(raised.value)
    assert "角色 旁白" in message
    assert "voice-missing.wav" in message
    assert "可用：" not in message


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
            role_table=[_role_row()],
            segment_table=[[1, "正文", "narrator", "旁白", "ZH", "测试。", "测试。", "中性叙述", "平静", 0.5, "自然", 0]],
            uploaded_files=None,
            model=UnexpectedModel(),
            model_lock=threading.Lock(),
            output_root=output_root,
            demo_dir=demo_dir,
            demo_voices={"voice_05.wav": "五号"},
            cancel_event=cancelled,
        )

    assert not list(output_root.glob("*"))


def test_render_applies_project_pronunciations_natural_rhythm_and_reuses_cache(tmp_path, monkeypatch):
    monkeypatch.setattr("text_director.time.time_ns", lambda: 1234567890)
    demo_dir = tmp_path / "voices"
    _write_wav(demo_dir / "voice_05.wav", 100)
    output_root = tmp_path / "outputs"
    process_root = tmp_path / "process"

    class FakeModel:
        def __init__(self):
            self.calls = []

        def infer(self, **kwargs):
            self.calls.append(kwargs)
            _write_wav(Path(kwargs["output_path"]), 100)
            return kwargs["output_path"]

    role_rows = [_role_row(rhythm="沉稳舒缓")]
    segment_rows = [[1, "第一章", "narrator", "旁白", "ZH", "重庆银行。", "重庆银行。", "中性叙述", "平静", 0.8, "舒缓", 100, "sly_smile", "笑意压在句尾，像已经掌握对方秘密"]]
    pronunciations = [["重庆银行", "重 庆 银行", "固定专名读法", "是"]]
    first_model = FakeModel()
    first = render_directed_audio(
        document={"title": "纠音缓存", "content_type": "novel"},
        role_table=role_rows,
        segment_table=segment_rows,
        pronunciation_table=pronunciations,
        uploaded_files=None,
        model=first_model,
        model_lock=threading.Lock(),
        output_root=output_root,
        project_process_dir=process_root,
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
    )

    assert first_model.calls[0]["text"] == "重 庆 银行。"
    assert first_model.calls[0]["duration_factor"] == 1.18
    assert "韵母自然舒展" in first_model.calls[0]["emo_text"]
    assert "短语间停连清晰" in first_model.calls[0]["emo_text"]
    assert "speaking with a sly mischievous smile" in first_model.calls[0]["emo_text"]
    assert "笑意压在句尾" in first_model.calls[0]["emo_text"]
    assert first_model.calls[0]["emo_alpha"] == 0.8
    first_manifest = json.loads(Path(first[2]).read_text(encoding="utf-8"))
    assert first_manifest["segments"][0]["effective_text"] == "重 庆 银行。"
    assert first_manifest["segments"][0]["text"] == "重庆银行。"
    assert first_manifest["segments"][0]["emotion_direction"] == "sly_smile"
    assert first_manifest["segments"][0]["emotion_weight"] == 0.8
    assert "slightly teasing and amused" in first_manifest["segments"][0]["emotion_text"]

    second_model = FakeModel()
    second = render_directed_audio(
        document={"title": "纠音缓存", "content_type": "novel"},
        role_table=role_rows,
        segment_table=segment_rows,
        pronunciation_table=pronunciations,
        uploaded_files=None,
        model=second_model,
        model_lock=threading.Lock(),
        output_root=output_root,
        project_process_dir=process_root,
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
    )
    second_manifest = json.loads(Path(second[2]).read_text(encoding="utf-8"))
    assert second_model.calls == []
    assert second_manifest["reused_segments"] == 1

    forced_model = FakeModel()
    forced = render_directed_audio(
        document={"title": "纠音缓存", "content_type": "novel"},
        role_table=role_rows,
        segment_table=segment_rows,
        pronunciation_table=pronunciations,
        uploaded_files=None,
        model=forced_model,
        model_lock=threading.Lock(),
        output_root=output_root,
        project_process_dir=process_root,
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
        force_segment_orders=[1],
    )
    forced_manifest = json.loads(Path(forced[2]).read_text(encoding="utf-8"))
    assert len(forced_model.calls) == 1
    assert forced_manifest["forced_segment_orders"] == [1]
    assert forced_manifest["segments"][0]["forced_regeneration"] is True

    fragment_model = FakeModel()
    fragment_rows = segment_rows + [[2, "第一章", "narrator", "旁白", "ZH", "新增片断。", "新增片断。", "中性叙述", "平静", 0.5, "自然", 100]]
    fragment_result = render_directed_audio(
        document={"title": "单句重生成", "content_type": "novel"},
        role_table=role_rows,
        segment_table=fragment_rows,
        pronunciation_table=pronunciations,
        uploaded_files=None,
        model=fragment_model,
        model_lock=threading.Lock(),
        output_root=output_root,
        project_process_dir=process_root,
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
        fragment_only_orders=[2],
    )
    assert len(fragment_model.calls) == 1
    assert fragment_model.calls[0]["text"] == "新增片断。"
    assert Path(fragment_result[0]).is_file()
    assert fragment_result[1:3] == ("", "")
    assert not Path(fragment_result[0]).is_relative_to(output_root)
    fragment_index = json.loads((process_root / "segment-fragments.json").read_text(encoding="utf-8"))
    assert next(iter(fragment_index["fragments"].values()))["order"] == 2

    assembled = render_directed_audio(
        document={"title": "纠音缓存", "content_type": "novel"},
        role_table=role_rows,
        segment_table=segment_rows,
        pronunciation_table=pronunciations,
        uploaded_files=None,
        model=object(),
        model_lock=threading.Lock(),
        output_root=output_root,
        project_process_dir=process_root,
        demo_dir=demo_dir,
        demo_voices={"voice_05.wav": "旁白"},
        cache_only=True,
    )
    assembled_manifest = json.loads(Path(assembled[2]).read_text(encoding="utf-8"))
    assert assembled_manifest["cache_only"] is True
    assert assembled_manifest["reused_segments"] == 1


def test_cache_only_render_reports_the_missing_segment_order(tmp_path):
    demo_dir = tmp_path / "voices"
    _write_wav(demo_dir / "voice_05.wav", 100)

    with pytest.raises(DirectorError, match="第 1 条分句缺少可串接"):
        render_directed_audio(
            document={"title": "缺失缓存", "content_type": "novel"},
            role_table=[_role_row()],
            segment_table=[[1, "正文", "narrator", "旁白", "ZH", "测试。", "测试。", "中性叙述", "平静", 0.5, "自然", 0]],
            uploaded_files=None,
            model=object(),
            model_lock=threading.Lock(),
            output_root=tmp_path / "outputs",
            project_process_dir=tmp_path / "process",
            demo_dir=demo_dir,
            demo_voices={"voice_05.wav": "旁白"},
            cache_only=True,
        )


def test_tables_reject_unknown_role_reference():
    role_rows = [_role_row()]
    segment_rows = [[1, "正文", "missing", "人物", "ZH", "原文", "原文", "中性叙述", "平静", 0.5, "自然", 300]]

    with pytest.raises(DirectorError, match="未知轨道"):
        tables_to_script(role_rows, segment_rows)


@pytest.mark.parametrize("text", ["李明说：", "她冷冷回应：", "记者问道:"])
def test_independent_speech_attribution_is_narrator_text(text):
    assert is_speech_attribution(text)


def test_spoken_sentence_with_reporting_verb_is_not_reclassified():
    assert not is_speech_attribution("他说今天会下雨。")


def _storyboard_shot_document():
    return {
        "characters": [{"id": "narrator", "name": "旁白"}, {"id": "role_01", "name": "笹垣"}],
        "scenes": [{
            "id": "scene_001",
            "title": "布施站外",
            "topic": "刑警前往案发现场",
            "location": "近铁布施站外",
            "spatial_direction": "车站出口朝向公路",
            "time": "清晨",
            "narrative_perspective": "第三人称",
            "mood": "冷峻",
            "storyboard_note": "这是场景级背景，只能用于维持地点连续性。",
            "shots": [
                {"id": "scene_001_shot_001", "source_text": "出了近铁布施站，笹垣沿着清晨的街道向前走。", "participants": ["role_01"], "start_segment_order": 1, "end_segment_order": 1, "start_seconds": 0.0, "end_seconds": 9.8, "storyboard_note": "", "authoring": "pending_ai"},
                {"id": "scene_001_shot_002", "source_text": "每当卡车疾驰而过，路旁积水便溅向他的裤脚。", "participants": ["role_01"], "start_segment_order": 2, "end_segment_order": 2, "start_seconds": 9.8, "end_seconds": 20.1, "storyboard_note": "", "authoring": "pending_ai"},
            ],
        }],
        "storyboard_regeneration": {"shot_notes_authored_by_ai": False},
    }


def test_ai_authors_each_storyboard_shot_from_its_own_source_text():
    director = OllamaTextDirector(DirectorConfig())
    prompts = []

    def request_structured(prompt, schema, **kwargs):
        prompts.append(prompt)
        assert kwargs["schema_name"] == "storyboard_shot_authoring"
        assert "出了近铁布施站" in prompt
        assert "每当卡车疾驰而过" in prompt
        return {
            "shots": [
                {"id": "scene_001_shot_001", "title": "走出布施站", "source_evidence": "笹垣沿着清晨的街道向前走", "participant_ids": [], "storyboard_note": "清晨冷光笼罩近铁布施站出口，笹垣从画面左后方走向街道纵深，中景跟拍他的步伐，前景保留湿润路面和站口边缘，远处建筑压低天际线，灰蓝色调与平视中景突出他独自赶路的动作。"},
                {"id": "scene_001_shot_002", "title": "卡车溅起积水", "source_evidence": "路旁积水便溅向他的裤脚", "participant_ids": [], "storyboard_note": "一辆卡车从画面右侧高速掠过，轮胎卷起路旁积水扑向笹垣裤脚，镜头降到膝部高度捕捉飞散水珠，人物在中景本能侧身，公路护栏延伸至背景，冷灰晨光在湿地上形成锐利反光。"},
            ],
        }, {"prompt_tokens": 100, "output_tokens": 80, "duration_seconds": 0.4}

    director._request_structured = request_structured
    source = _storyboard_shot_document()
    result = director.author_storyboard_shots(source)
    shots = result["scenes"][0]["shots"]

    assert len(prompts) == 1
    assert shots[0]["storyboard_note"] != shots[1]["storyboard_note"]
    assert shots[0]["source_evidence"] == "笹垣沿着清晨的街道向前走"
    assert shots[1]["source_evidence"] == "路旁积水便溅向他的裤脚"
    assert all(shot["authoring"] == "ai_shot_source" for shot in shots)
    assert all(shot["participants"] == ["role_01"] for shot in shots)
    assert all(shot["participant_resolution"] == "ai_plus_source_continuity" for shot in shots)
    assert result["storyboard_regeneration"]["shot_notes_authored_by_ai"] is True
    assert source["scenes"][0]["shots"][0]["storyboard_note"] == ""


def test_ai_storyboard_shot_authoring_rejects_duplicate_notes_without_partial_update():
    director = OllamaTextDirector(DirectorConfig())
    duplicate = "清晨街道采用平视中景，人物位于画面中央向前行走，湿润路面延伸到背景，冷灰光线勾勒人物轮廓，前景保留水迹与道路边缘，镜头完整呈现人物动作、空间方向和环境关键物件。"
    director._request_structured = lambda *_args, **_kwargs: ({
        "shots": [
            {"id": "scene_001_shot_001", "title": "走出车站", "source_evidence": "出了近铁布施站", "participant_ids": ["role_01"], "storyboard_note": duplicate},
            {"id": "scene_001_shot_002", "title": "卡车经过", "source_evidence": "每当卡车疾驰而过", "participant_ids": ["role_01"], "storyboard_note": duplicate},
        ],
    }, {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.1})
    source = _storyboard_shot_document()

    with pytest.raises(DirectorValidationError, match="完全重复"):
        director.author_storyboard_shots(source)

    assert all(shot["storyboard_note"] == "" for shot in source["scenes"][0]["shots"])


def test_ai_storyboard_shot_authoring_rejects_evidence_from_another_shot():
    director = OllamaTextDirector(DirectorConfig())
    director._request_structured = lambda *_args, **_kwargs: ({
        "shots": [
            {"id": "scene_001_shot_001", "title": "走出车站", "source_evidence": "卡车疾驰而过", "participant_ids": ["role_01"], "storyboard_note": "清晨冷光笼罩车站出口，人物从站口步入湿润街道，中景平视跟随他的行进方向，前景保留路面反光，背景建筑逐层收拢，灰蓝色调强调独自赶路时的克制氛围与空间纵深。"},
            {"id": "scene_001_shot_002", "title": "卡车经过", "source_evidence": "卡车疾驰而过", "participant_ids": ["role_01"], "storyboard_note": "卡车贴近路边高速掠过，轮胎卷起积水扑向人物裤脚，低机位近景冻结飞散水珠，人物在中景侧身闪避，护栏和湿路延伸至远处，冷灰晨光在水面形成明亮反射。"},
        ],
    }, {"prompt_tokens": 1, "output_tokens": 1, "duration_seconds": 0.1})

    with pytest.raises(DirectorValidationError, match="不属于该镜头对应原文"):
        director.author_storyboard_shots(_storyboard_shot_document())


def test_ai_storyboard_shot_authoring_rewrites_the_whole_batch_after_validation_failure():
    director = OllamaTextDirector(DirectorConfig())
    attempts = []

    def request_structured(prompt, *_args, **_kwargs):
        attempts.append(prompt)
        short = len(attempts) == 1
        return ({
            "shots": [
                {"id": "scene_001_shot_001", "title": "走出车站", "source_evidence": "出了近铁布施站", "participant_ids": [], "storyboard_note": "描述过短。" if short else "清晨冷光压在近铁布施站出口，笹垣从站口走向街道纵深，平视中景跟随他的步伐，前景湿路反光，背景建筑压低天际线，灰蓝色调和站口阴影共同表现他独自赶路时的沉重状态。"},
                {"id": "scene_001_shot_002", "title": "卡车经过", "source_evidence": "路旁积水便溅向他的裤脚", "participant_ids": [], "storyboard_note": "卡车从画面右侧高速掠过，轮胎卷起路旁积水扑向笹垣裤脚，低机位近景捕捉飞散水珠，人物在中景侧身闪避，公路护栏延伸到背景，冷灰晨光在湿地形成锐利反射。"},
            ],
        }, {"prompt_tokens": 10, "output_tokens": 10, "duration_seconds": 0.1})

    director._request_structured = request_structured
    result = director.author_storyboard_shots(_storyboard_shot_document())

    assert len(attempts) == 2
    assert "上一次输出未通过校验" in attempts[1]
    assert result["storyboard_regeneration"]["shot_note_metrics"]["requests"] == 2
