from __future__ import annotations

import argparse
import html
import os
import threading
import time
from pathlib import Path

import gradio as gr
import torch

from indextts.infer_v2_5 import IndexTTS2
from text_director import (
    CONTENT_TYPES,
    CONTENT_TYPE_LABELS,
    DirectorConfig,
    DirectorError,
    OllamaTextDirector,
    ROLE_HEADERS,
    SEGMENT_HEADERS,
    document_to_tables,
    render_directed_audio,
    voice_catalog_markdown,
)


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "outputs" / "production"
DIRECTOR_OUTPUT_DIR = ROOT / "outputs" / "director"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DIRECTOR_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

DEMO_VOICES = {
    "voice_01.wav": "音色 01｜英语短句｜2.4 秒",
    "voice_02.wav": "音色 02｜英语情绪对白｜2.9 秒",
    "voice_03.wav": "音色 03｜中文宣传语｜2.1 秒",
    "voice_04.wav": "音色 04｜中文叙述｜2.4 秒",
    "voice_05.wav": "音色 05｜中文长叙述｜8.4 秒",
    "voice_06.wav": "音色 06｜中文诗句｜6.2 秒",
    "voice_07.wav": "音色 07｜阿拉伯语与中文｜2.0 秒",
    "voice_08.wav": "音色 08｜西班牙语与中文｜1.5 秒",
    "voice_09.wav": "音色 09｜中文活泼对白｜10.2 秒",
    "voice_11.wav": "音色 11｜中文低落对白｜7.9 秒",
    "voice_12.wav": "音色 12｜日语与中文｜2.7 秒",
}
DEMO_VOICE_CHOICES = [(label, filename) for filename, label in DEMO_VOICES.items()]
DEFAULT_DEMO_VOICE = next(iter(DEMO_VOICES))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Index Voice Studio production UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--model-dir", default=str(ROOT / "checkpoints"))
    parser.add_argument("--ai-base-url", default=os.getenv("INDEXTTS_AI_BASE_URL", "http://127.0.0.1:11434"))
    parser.add_argument("--ai-model", default=os.getenv("INDEXTTS_AI_MODEL", "qwen3:14b"))
    parser.add_argument("--ai-timeout", type=int, default=int(os.getenv("INDEXTTS_AI_TIMEOUT", "300")))
    parser.add_argument("--ai-chunk-chars", type=int, default=int(os.getenv("INDEXTTS_AI_CHUNK_CHARS", "3600")))
    return parser.parse_args()


ARGS = parse_args()
MODEL_DIR = Path(ARGS.model_dir).resolve()
MODEL = IndexTTS2(
    cfg_path=str(MODEL_DIR / "config.yaml"),
    model_dir=str(MODEL_DIR),
    use_bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
    use_cuda_kernel=False,
    use_deepspeed=False,
    use_accel=False,
    use_torch_compile=False,
    use_qwen_emo=True,
)
MODEL_LOCK = threading.Lock()
TEXT_DIRECTOR = OllamaTextDirector(
    DirectorConfig(
        base_url=ARGS.ai_base_url,
        model=ARGS.ai_model,
        timeout_seconds=ARGS.ai_timeout,
        max_chunk_chars=ARGS.ai_chunk_chars,
    )
)

LANGUAGES = {
    "中文": "ZH",
    "English": "EN",
    "日本語": "JA",
    "Español": "ES",
    "العربية": "AR",
}
EMOTIONS = ["沿用音色参考情绪", "使用情绪参考音频", "使用八维情绪向量", "使用情绪描述文本"]


def toggle_emotion_controls(mode: str):
    return (
        gr.update(visible=mode == EMOTIONS[1]),
        gr.update(visible=mode == EMOTIONS[2]),
        gr.update(visible=mode == EMOTIONS[3]),
        gr.update(visible=mode in EMOTIONS[1:]),
        gr.update(visible=mode in EMOTIONS[2:]),
    )


def load_demo_voice(filename: str):
    if filename not in DEMO_VOICES:
        raise gr.Error("请选择有效的演示音色。")
    demo_voice = ROOT / "examples" / filename
    if not demo_voice.exists():
        raise gr.Error("演示音色尚未下载，请先执行示例音频下载命令。")
    return str(demo_voice)


def generate_speech(
    prompt_audio: str | None,
    text: str,
    language_label: str,
    duration_factor: float,
    emotion_mode: str,
    emotion_audio: str | None,
    emotion_weight: float,
    emotion_text: str,
    emotion_random: bool,
    happy: float,
    angry: float,
    sad: float,
    afraid: float,
    disgusted: float,
    melancholic: float,
    surprised: float,
    calm: float,
):
    if not prompt_audio:
        raise gr.Error("请先上传 3 至 15 秒的清晰参考音频。")
    cleaned_text = (text or "").strip()
    if not cleaned_text:
        raise gr.Error("请输入需要合成的文本。")
    if len(cleaned_text) > 1200:
        raise gr.Error("单次文本请控制在 1200 字符以内。")

    emotion_reference = None
    emotion_vector = None
    use_emotion_text = emotion_mode == EMOTIONS[3]
    if emotion_mode == EMOTIONS[1]:
        if not emotion_audio:
            raise gr.Error("当前情感模式需要上传情感参考音频。")
        emotion_reference = emotion_audio
    elif emotion_mode == EMOTIONS[2]:
        emotion_vector = MODEL.normalize_emo_vec(
            [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm],
            apply_bias=True,
        )

    output_path = OUTPUT_DIR / f"voice-{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 1_000_000:06d}.wav"
    started = time.perf_counter()
    with MODEL_LOCK:
        result = MODEL.infer(
            spk_audio_prompt=prompt_audio,
            text=cleaned_text,
            lang=LANGUAGES[language_label],
            output_path=str(output_path),
            emo_audio_prompt=emotion_reference,
            emo_alpha=float(emotion_weight),
            emo_vector=emotion_vector,
            use_emo_text=use_emotion_text,
            emo_text=(emotion_text or "").strip() or None,
            use_random=bool(emotion_random),
            duration_factor=float(duration_factor),
            max_text_tokens_per_segment=120,
            verbose=False,
        )
    elapsed = time.perf_counter() - started
    if not result or not output_path.exists():
        raise gr.Error("生成未产生有效音频，请调整文本或参考音频后重试。")
    status = (
        f"<div class='result-meta'><span>生成完成</span>"
        f"<strong>{elapsed:.1f} 秒</strong><span>{language_label}</span>"
        f"<span>{emotion_mode}</span><span>时长系数 {duration_factor:.2f}</span></div>"
    )
    return str(output_path), status


def analyze_director_document(
    content_type_label: str,
    source_text: str,
    guidance: str,
    progress=gr.Progress(),
):
    try:
        ai_status = TEXT_DIRECTOR.health_summary()
        content_type = CONTENT_TYPES.get(content_type_label)
        if content_type is None:
            raise DirectorError(f"不支持的内容体裁：{content_type_label}")
        document = TEXT_DIRECTOR.analyze_document(
            source_text,
            content_type=content_type,
            guidance=guidance,
            progress=progress,
        )
        role_rows, segment_rows = document_to_tables(document, DEMO_VOICES)
    except DirectorError as exc:
        raise gr.Error(str(exc)) from exc
    metrics = document["metrics"]
    detected_label = CONTENT_TYPE_LABELS.get(document["content_type"], document["content_type"])
    summary = (
        f"### AI 导演完成\n\n"
        f"**标题**　{html.escape(document['title'])}\n\n"
        f"**体裁**　{detected_label}　　**角色轨道**　{len(role_rows)}　　"
        f"**合成分句**　{len(segment_rows)}　　**原文覆盖**　100%\n\n"
        f"**AI**　{ai_status}　　**文本块**　{metrics['chunks']}　　"
        f"**Token**　{metrics['prompt_tokens']} → {metrics['output_tokens']}　　"
        f"**耗时**　{metrics['duration_seconds']:.1f} 秒"
    )
    return document, role_rows, segment_rows, document["cleaned_text"], summary


def generate_directed_project(
    document: dict | None,
    role_table,
    segment_table,
    uploaded_voices: list[str] | None,
    progress=gr.Progress(),
):
    if not document or not document.get("segments"):
        raise gr.Error("请先完成 AI 文本导演分析。")
    try:
        master, package, manifest, status = render_directed_audio(
            document=document,
            role_table=role_table,
            segment_table=segment_table,
            uploaded_files=uploaded_voices,
            model=MODEL,
            model_lock=MODEL_LOCK,
            output_root=DIRECTOR_OUTPUT_DIR,
            demo_dir=ROOT / "examples",
            demo_voices=DEMO_VOICES,
            progress=progress,
        )
    except DirectorError as exc:
        raise gr.Error(str(exc)) from exc
    return master, package, manifest, f"### 长篇音频生成完成\n\n{status}"


CSS = """
:root {
  --studio-orange: #fd6d26;
  --studio-orange-dark: #e85915;
  --studio-ink: #24272b;
  --studio-muted: #687078;
  --studio-line: #e5e8eb;
  --studio-bg: #f7f8fa;
}
body, .gradio-container {
  background: var(--studio-bg) !important;
  color: var(--studio-ink) !important;
  font-family: Lato, "Noto Sans JP", "Noto Sans SC", "Microsoft YaHei", sans-serif !important;
}
.gradio-container { max-width: none !important; padding: 0 !important; }
.studio-shell { max-width: 1240px; margin: 0 auto; padding: 0 28px 48px; }
.studio-header {
  height: 72px; background: #fff; border-bottom: 1px solid var(--studio-line);
  display: flex; align-items: center; justify-content: space-between; padding: 0 max(28px, calc((100vw - 1184px)/2));
}
.studio-brand { display:flex; align-items:center; gap:14px; }
.studio-mark { width:34px; height:34px; border-radius:8px; background:var(--studio-orange); color:#fff; display:grid; place-items:center; font-weight:800; }
.studio-brand strong { font-size:18px; letter-spacing:.01em; }
.studio-brand small { display:block; color:var(--studio-muted); font-size:11px; margin-top:2px; }
.studio-health { display:flex; align-items:center; gap:8px; font-size:13px; color:#3f674e; }
.studio-health i { width:8px; height:8px; border-radius:50%; background:#4faa6b; box-shadow:0 0 0 4px #e8f5ec; }
.studio-hero { padding:44px 0 30px; display:flex; justify-content:space-between; align-items:flex-end; gap:24px; }
.studio-eyebrow { color:var(--studio-orange); font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
.studio-hero h1 { font-size:38px; line-height:1.25; margin:9px 0 10px; letter-spacing:-.02em; }
.studio-hero p { color:var(--studio-muted); margin:0; max-width:700px; line-height:1.8; }
.studio-version { background:#fff; border:1px solid var(--studio-line); border-radius:8px; padding:12px 16px; color:var(--studio-muted); font-size:12px; white-space:nowrap; }
.workspace-row { gap:20px !important; align-items:stretch !important; }
.studio-card { background:#fff !important; border:1px solid var(--studio-line) !important; border-radius:8px !important; padding:24px !important; box-shadow:0 3px 14px rgba(27,31,35,.04); }
.studio-card h3 { font-size:18px; margin:0 0 4px; }
.studio-card .section-note { color:var(--studio-muted); font-size:13px; line-height:1.65; margin-bottom:18px; }
.studio-step { display:inline-grid; place-items:center; width:24px; height:24px; border-radius:50%; background:#fff0e9; color:var(--studio-orange-dark); font-weight:800; font-size:12px; margin-right:8px; }
.studio-card label span { font-weight:700 !important; color:#373b40 !important; }
.studio-card textarea, .studio-card input { border-color:#dfe3e6 !important; border-radius:8px !important; }
.studio-card textarea:focus, .studio-card input:focus { border-color:var(--studio-orange) !important; box-shadow:0 0 0 3px rgba(253,109,38,.12) !important; }
.studio-primary { background:var(--studio-orange) !important; color:#fff !important; border:0 !important; border-radius:8px !important; min-height:48px !important; font-weight:800 !important; box-shadow:0 8px 20px rgba(253,109,38,.2); }
.studio-primary:hover { background:var(--studio-orange-dark) !important; }
.result-panel { min-height:246px; }
.result-meta { display:flex; flex-wrap:wrap; gap:8px; align-items:center; color:var(--studio-muted); font-size:12px; margin-top:10px; }
.result-meta span, .result-meta strong { background:#f1f3f5; border-radius:999px; padding:5px 9px; }
.result-meta strong { background:#eaf6ee; color:#34734a; }
.studio-trust { margin-top:20px; display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
.studio-trust div { background:#fff; border:1px solid var(--studio-line); border-radius:8px; padding:16px; }
.studio-trust strong { display:block; font-size:13px; margin-bottom:5px; }
.studio-trust span { color:var(--studio-muted); font-size:12px; line-height:1.55; }
.studio-tabs > .tab-nav { max-width:1240px; margin:0 auto 18px; }
.director-table { border:1px solid var(--studio-line) !important; border-radius:8px !important; }
footer { display:none !important; }
@media (max-width: 780px) {
  .studio-header { padding:0 18px; }
  .studio-shell { padding:0 16px 32px; }
  .studio-hero { align-items:flex-start; flex-direction:column; padding-top:30px; }
  .studio-hero h1 { font-size:30px; }
  .workspace-row { flex-direction:column !important; }
  .studio-trust { grid-template-columns:1fr; }
}
"""


def build_ui() -> gr.Blocks:
    with gr.Blocks(title="Index Voice Studio", css=CSS, theme=gr.themes.Base()) as app:
        gr.HTML("""
        <header class="studio-header">
          <div class="studio-brand"><div class="studio-mark">IV</div><div><strong>Index Voice Studio</strong><small>IndexTTS 2.5 Production Workspace</small></div></div>
          <div class="studio-health"><i></i><span>GPU 服务正常</span></div>
        </header>
        <main class="studio-shell">
          <section class="studio-hero"><div><div class="studio-eyebrow">VOICE PRODUCTION</div><h1>把文字导演与声音创作，变成完整工作流。</h1><p>单句创作与 AI 长篇导演并行提供。全文可智能清洗、分段、分句、识别人物与旁白、标注态度语气，再按角色音色生成分轨和完整音频。</p></div><div class="studio-version">IndexTTS 2.5 · Qwen3 · CUDA</div></section>
        """)
        with gr.Tabs(elem_classes="studio-tabs"):
            with gr.Tab("单句创作"):
                with gr.Row(elem_classes="workspace-row"):
                    with gr.Column(scale=6, elem_classes="studio-card"):
                        gr.HTML("<h3><span class='studio-step'>1</span>创作设置</h3><div class='section-note'>参考音频决定音色。建议使用无背景音乐的单人干声，模型最多读取前 15 秒。</div>")
                        demo_voice = gr.Dropdown(
                            choices=DEMO_VOICE_CHOICES,
                            value=DEFAULT_DEMO_VOICE,
                            label="演示音色",
                            info="选择后会自动载入下方播放器，可先试听再生成。",
                        )
                        prompt_audio = gr.Audio(
                            value=str(ROOT / "examples" / DEFAULT_DEMO_VOICE),
                            label="音色参考音频",
                            sources=["upload", "microphone"],
                            type="filepath",
                        )
                        text = gr.TextArea(label="目标文本", placeholder="输入需要合成的内容", lines=6, max_lines=12)
                        with gr.Row():
                            language = gr.Dropdown(list(LANGUAGES), value="中文", label="语言")
                            duration = gr.Slider(0.5, 2.0, value=1.0, step=0.01, label="时长系数", info="数值越小越快，数值越大越慢")
                        with gr.Accordion("情绪与表达", open=True):
                            emotion_mode = gr.Radio(EMOTIONS, value=EMOTIONS[0], label="情绪控制方式")
                            with gr.Group(visible=False) as emotion_audio_group:
                                gr.Markdown("只提取表达情绪，音色仍由上方音色参考音频决定。")
                                emotion_audio = gr.Audio(label="情绪参考音频", type="filepath")
                            with gr.Group(visible=False) as vector_group:
                                gr.Markdown("八项数值会先按模型规则归一化，再由情绪作用强度整体缩放。")
                                with gr.Row():
                                    happy = gr.Slider(0, 1, 0, .05, label="喜悦")
                                    angry = gr.Slider(0, 1, 0, .05, label="愤怒")
                                    sad = gr.Slider(0, 1, 0, .05, label="悲伤")
                                    afraid = gr.Slider(0, 1, 0, .05, label="恐惧")
                                with gr.Row():
                                    disgusted = gr.Slider(0, 1, 0, .05, label="厌恶")
                                    melancholic = gr.Slider(0, 1, 0, .05, label="低落")
                                    surprised = gr.Slider(0, 1, 0, .05, label="惊喜")
                                    calm = gr.Slider(0, 1, 0, .05, label="平静")
                            with gr.Group(visible=False) as emotion_text_group:
                                gr.Markdown("情绪描述文本由本地 QwenEmotion 模型解析。留空时使用目标文本判断情绪。")
                                emotion_text = gr.Textbox(
                                    label="情绪描述文本",
                                    placeholder="例如：克制的喜悦、强烈的委屈、危险正在逼近",
                                    lines=2,
                                )
                            with gr.Group(visible=False) as emotion_strength_group:
                                emotion_weight = gr.Slider(
                                    0.0, 1.0, value=0.65, step=0.01,
                                    label="情绪作用强度",
                                    info="0 表示不施加额外情绪，1 表示完整使用所选情绪条件。",
                                )
                            with gr.Group(visible=False) as emotion_random_group:
                                emotion_random = gr.Checkbox(
                                    label="情绪随机采样",
                                    value=False,
                                    info="在相同情绪方向内随机选择表达特征，每次结果可能不同。",
                                )
                        generate = gr.Button("生成语音", variant="primary", elem_classes="studio-primary")
                    with gr.Column(scale=4, elem_classes="studio-card result-panel"):
                        gr.HTML("<h3><span class='studio-step'>2</span>生成结果</h3><div class='section-note'>生成完成后可直接试听或下载 WAV 文件。</div>")
                        output_audio = gr.Audio(label="语音预览", type="filepath")
                        result_status = gr.HTML("<div class='result-meta'><span>等待生成</span><span>22.05 kHz WAV</span></div>")
                        gr.Markdown("""
**使用建议**

- 调整时长系数会作用于模型内部声学长度调节器。
- 音色与情感可分别使用不同参考音频。
- 涉及他人声音时，请先取得合法授权。
                        """)

            with gr.Tab("AI 长篇导演"):
                director_state = gr.State({})
                with gr.Row(elem_classes="workspace-row"):
                    with gr.Column(scale=5, elem_classes="studio-card"):
                        gr.HTML("<h3><span class='studio-step'>1</span>全文输入与 AI 导演</h3><div class='section-note'>AI 会清洗全文，按自然段和句子切分，识别人物与旁白，并逐句标注态度、情绪、语速和停顿。</div>")
                        director_content_type = gr.Dropdown(
                            choices=list(CONTENT_TYPES),
                            value="自动识别",
                            label="内容体裁",
                            info="小说、新闻和故事采用不同的旁白、角色和表达策略。",
                        )
                        director_source = gr.TextArea(
                            label="全文原稿",
                            placeholder="粘贴小说章节、新闻稿或故事全文。长文会按自然边界分块，并保持角色连续性。",
                            lines=18,
                            max_lines=40,
                        )
                        director_guidance = gr.TextArea(
                            label="导演补充",
                            placeholder="可选，例如：整体克制悬疑；新闻播报避免夸张；儿童故事更有亲和力。",
                            lines=3,
                        )
                        director_analyze = gr.Button("AI 清洗并分段分句分轨", variant="primary", elem_classes="studio-primary")
                    with gr.Column(scale=5, elem_classes="studio-card"):
                        gr.HTML("<h3><span class='studio-step'>2</span>导演结果</h3><div class='section-note'>AI 结果必须通过原文覆盖校验，出现漏文或顺序变化时会自动纠正一次。</div>")
                        director_summary = gr.Markdown(
                            f"等待 AI 导演分析。当前配置：`{ARGS.ai_model}`　`{ARGS.ai_base_url}`"
                        )
                        director_cleaned = gr.TextArea(
                            label="清洗后的完整朗读稿",
                            lines=18,
                            max_lines=40,
                            interactive=False,
                            show_copy_button=True,
                        )

                with gr.Accordion("角色与音色映射", open=True):
                    gr.Markdown(voice_catalog_markdown(DEMO_VOICES))
                    director_uploaded_voices = gr.File(
                        label="上传自定义角色音色",
                        file_count="multiple",
                        file_types=["audio"],
                        type="filepath",
                    )
                    director_roles = gr.Dataframe(
                        headers=ROLE_HEADERS,
                        datatype=["str"] * len(ROLE_HEADERS),
                        type="array",
                        value=[],
                        row_count=(1, "dynamic"),
                        col_count=(len(ROLE_HEADERS), "fixed"),
                        label="角色轨道表，可修改角色说明和音色ID",
                        interactive=True,
                        max_height=360,
                        wrap=True,
                        show_search="filter",
                        elem_classes="director-table",
                    )

                with gr.Accordion("分句分轨与态度语气", open=True):
                    director_segments = gr.Dataframe(
                        headers=SEGMENT_HEADERS,
                        datatype=["number", "str", "str", "str", "str", "str", "str", "str", "str", "number", "str", "number"],
                        type="array",
                        value=[],
                        row_count=(1, "dynamic"),
                        col_count=(len(SEGMENT_HEADERS), "fixed"),
                        label="逐句导演表，可人工校正分轨、文本、态度、情绪、强度、语速和停顿",
                        interactive=True,
                        max_height=520,
                        wrap=True,
                        show_search="filter",
                        static_columns=[0],
                        elem_classes="director-table",
                    )
                    director_generate = gr.Button("按角色音色生成完整音频", variant="primary", elem_classes="studio-primary")

                with gr.Row(elem_classes="workspace-row"):
                    with gr.Column(scale=6, elem_classes="studio-card result-panel"):
                        gr.HTML("<h3><span class='studio-step'>3</span>完整音频</h3><div class='section-note'>按分句顺序、角色音色、态度情绪、语速和停顿生成。</div>")
                        director_master = gr.Audio(label="完整音频预览", type="filepath")
                    with gr.Column(scale=4, elem_classes="studio-card result-panel"):
                        gr.HTML("<h3><span class='studio-step'>4</span>分轨交付</h3><div class='section-note'>交付包包含完整 WAV、逐句 WAV、角色轨道、CSV 脚本和 JSON 清单。</div>")
                        director_package = gr.File(label="下载分轨交付包")
                        director_manifest = gr.File(label="下载导演清单")
                        director_render_status = gr.Markdown("等待生成。")

        gr.HTML("""
        <section class="studio-trust">
          <div><strong>本地处理</strong><span>参考音频与生成结果保存在当前服务器，不上传至第三方业务系统。</span></div>
          <div><strong>AI 文本导演</strong><span>本机 Qwen3 负责全文清洗、分段分句、人物旁白识别和态度语气标注。</span></div>
          <div><strong>多语言输出</strong><span>支持中文、英文、日文、西班牙文与阿拉伯文生成。</span></div>
          <div><strong>可控时长</strong><span>0.50 至 2.00 的模型级时长系数，适用于配音与内容制作。</span></div>
        </section></main>
        """)

        demo_voice.change(load_demo_voice, demo_voice, prompt_audio)
        emotion_mode.change(
            toggle_emotion_controls,
            emotion_mode,
            [emotion_audio_group, vector_group, emotion_text_group, emotion_strength_group, emotion_random_group],
        )
        generate.click(
            generate_speech,
            inputs=[
                prompt_audio, text, language, duration, emotion_mode, emotion_audio, emotion_weight,
                emotion_text, emotion_random,
                happy, angry, sad, afraid, disgusted, melancholic, surprised, calm,
            ],
            outputs=[output_audio, result_status],
        )
        director_analyze.click(
            analyze_director_document,
            inputs=[director_content_type, director_source, director_guidance],
            outputs=[director_state, director_roles, director_segments, director_cleaned, director_summary],
        )
        director_generate.click(
            generate_directed_project,
            inputs=[director_state, director_roles, director_segments, director_uploaded_voices],
            outputs=[director_master, director_package, director_manifest, director_render_status],
        )
    return app


APP = build_ui()

if __name__ == "__main__":
    APP.queue(default_concurrency_limit=1, max_size=20).launch(
        server_name=ARGS.host,
        server_port=ARGS.port,
        show_error=True,
        max_file_size="50mb",
    )
