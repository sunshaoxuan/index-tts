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


def test_production_ui_exposes_ai_long_form_director_workflow():
    assert "from text_director import" in SOURCE
    assert 'with gr.Tab("AI 长篇导演")' in SOURCE
    assert 'label="内容体裁"' in SOURCE
    assert 'label="全文原稿"' in SOURCE
    assert 'label="导演补充"' in SOURCE
    assert '"AI 清洗并分段分句分轨"' in SOURCE
    assert "ROLE_HEADERS" in SOURCE
    assert "SEGMENT_HEADERS" in SOURCE
    assert 'label="上传自定义角色音色"' in SOURCE
    assert '"按角色音色生成完整音频"' in SOURCE
    assert 'label="完整音频预览"' in SOURCE
    assert 'label="下载分轨交付包"' in SOURCE


def test_production_ui_connects_ai_analysis_and_tts_render_handlers():
    assert 'str(ROOT / "text_director_worker.py")' in SOURCE
    assert "render_directed_audio(" in SOURCE
    assert "director_analyze.click(" in SOURCE
    assert "director_generate.click(" in SOURCE
    assert "原文覆盖**　100%" in SOURCE


def test_production_ui_exposes_readable_tables_and_real_task_feedback():
    assert SOURCE.count("wrap=False") >= 3
    assert "column_widths=[130, 110, 110, 260, 360, 190, 130, 110]" in SOURCE
    assert "pinned_columns=2" in SOURCE
    assert "pinned_columns=5" in SOURCE
    assert 'show_progress="hidden"' in SOURCE
    for label in ("取消分析", "取消音色设计", "取消完整音频生成"):
        assert label in SOURCE
    assert "activity-card" in SOURCE
    assert "cancel_active_task" in SOURCE
    assert 'gr.update(value=button_label, interactive=True, visible=True)' in SOURCE
    assert 'task_payload["restore_indextts"] = True' in SOURCE
    assert "worker.join()" in SOURCE
    assert "cancel_analysis_task" in SOURCE
    assert "cancel_render_task" in SOURCE
    assert "工程分句缓存已经保留" in SOURCE


def test_production_ui_exposes_voice_design_strategy_and_preview():
    assert '"AI 设计全新角色音色"' in SOURCE
    assert '"智能匹配内置音色"' in SOURCE
    assert 'label="角色音色试听"' in SOURCE
    assert 'label="生成音色预览"' in SOURCE
    assert 'str(ROOT / "voice_design_worker.py")' in SOURCE
    assert "generated_files=generated_voices" in SOURCE
    assert "_release_indextts_model()" in SOURCE
    assert "长文本分轨已经完成，正在恢复 IndexTTS 音频模型" in SOURCE
    assert "安全分段块" in SOURCE
    assert "_restore_indextts_model()" in SOURCE
    assert 'default=os.getenv("INDEXTTS_AI_MODEL", "qwen3:8b")' in SOURCE
    assert 'default=int(os.getenv("INDEXTTS_AI_TIMEOUT", "300"))' in SOURCE
    assert 'default=int(os.getenv("INDEXTTS_AI_CHUNK_CHARS", "1400"))' in SOURCE
    assert '"kind": "analysis"' in SOURCE
    assert "_release_indextts_model()" in SOURCE


def test_production_ui_exposes_persistent_novel_projects_voice_library_and_pronunciation():
    for text in (
        "小说工程",
        "创建新工程",
        "打开工程",
        "保存当前工程",
        "音色设计条件",
        "角色表达节奏",
        "重新生成",
        "永久音色库",
        "全篇固定纠音表",
        "添加纠音规则",
        "批量修改角色归属",
        "长篇导演不会用整句倍数冒充自然语速",
    ):
        assert text in SOURCE
    assert "NovelProjectStore" in SOURCE
    assert "PROJECT_STORE.register_voice" in SOURCE
    assert "project_process_dir=project_dir / \"process\"" in SOURCE
    assert "pronunciation_table=pronunciation_table" in SOURCE
