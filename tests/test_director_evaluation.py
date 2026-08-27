import pytest

from director_evaluation import boundary_scores, evaluate, exact_interval_agreement


def segment(text, speaker="narrator", attitude="中性叙述"):
    return {"source_text": text, "speaker_id": speaker, "attitude": attitude, "emotion": "calm", "intensity": 0.5, "pace": "自然", "pause_after_ms": 300, "scene_id": "scene_001"}


def test_scores_boundary_precision_recall_and_field_agreement_on_exact_intervals():
    reference = [segment("甲。"), segment("乙。", "role_001"), segment("丙。")]
    candidate = [segment("甲。"), segment("乙。丙。", "role_001")]
    scores = boundary_scores(candidate, reference)
    assert scores == {"candidate_boundaries": 1, "reference_boundaries": 2, "common_boundaries": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6667}
    agreement = exact_interval_agreement(candidate, reference, ["speaker_id"])
    assert agreement["exact_intervals"] == 1
    assert agreement["fields"]["speaker_id"]["agreement"] == 1.0


def test_evaluation_rejects_results_that_do_not_cover_the_same_source():
    with pytest.raises(ValueError, match="同一原文"):
        evaluate({"segments": [segment("甲。")]}, {"segments": [segment("乙。")]})
