import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "production_webui.py").read_text(encoding="utf-8")


def test_production_ui_uses_real_v25_inference_contract():
    assert "from indextts.infer_v2_5 import IndexTTS2" in SOURCE
    assert "duration_factor=float(duration_factor)" in SOURCE
    assert "lang=LANGUAGES[language_label]" in SOURCE
    assert "use_cuda_kernel=False" in SOURCE
    assert "MODEL_LOCK" in SOURCE
    assert "demo_voice.change(load_demo_voice, demo_voice, prompt_audio)" in SOURCE


def test_production_ui_exposes_all_local_demo_voices():
    tree = ast.parse(SOURCE)
    demo_voices = None
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "DEMO_VOICES"
            for target in node.targets
        ):
            demo_voices = ast.literal_eval(node.value)
            break

    assert demo_voices is not None
    audio_files = {path.name for path in (ROOT / "examples").glob("voice_*.wav")}
    assert set(demo_voices) == audio_files
    assert len(demo_voices) == 11
    assert "DEMO_VOICE_CHOICES" in SOURCE
    assert "选择后会自动载入下方播放器" in SOURCE


def test_production_ui_exposes_complete_v25_emotion_contract():
    assert "use_qwen_emo=True" in SOURCE
    for mode in ("沿用音色参考情绪", "使用情绪参考音频", "使用八维情绪向量", "使用情绪描述文本"):
        assert mode in SOURCE
    for emotion in ("喜悦", "愤怒", "悲伤", "恐惧", "厌恶", "低落", "惊喜", "平静"):
        assert f'label="{emotion}"' in SOURCE
    assert "use_emo_text=use_emotion_text" in SOURCE
    assert 'emo_text=(emotion_text or "").strip() or None' in SOURCE
    assert "use_random=bool(emotion_random)" in SOURCE
    assert 'label="情绪作用强度"' in SOURCE
    assert 'label="情绪随机采样"' in SOURCE


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
