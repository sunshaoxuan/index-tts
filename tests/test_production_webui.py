from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "production_webui.py").read_text(encoding="utf-8")


def test_production_ui_uses_real_v25_inference_contract():
    assert "from indextts.infer_v2_5 import IndexTTS2" in SOURCE
    assert "duration_factor=float(duration_factor)" in SOURCE
    assert "lang=LANGUAGES[language_label]" in SOURCE
    assert "use_cuda_kernel=False" in SOURCE
    assert "MODEL_LOCK" in SOURCE
    assert "demo_voice.click(load_demo_voice, outputs=prompt_audio)" in SOURCE


def test_production_ui_has_onehr_visual_language_and_own_identity():
    assert "Index Voice Studio" in SOURCE
    assert "#f7f8fa" in SOURCE
    assert "#fd6d26" in SOURCE
    assert 'border-radius:8px' in SOURCE
    assert 'Noto Sans JP' in SOURCE
    assert "One人事" not in SOURCE


def test_production_ui_only_exposes_supported_languages_and_duration_range():
    for language in ("ZH", "EN", "JA", "ES", "AR"):
        assert f'"{language}"' in SOURCE
    assert "gr.Slider(0.5, 2.0" in SOURCE
    assert "max_file_size=\"50mb\"" in SOURCE
