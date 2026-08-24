from __future__ import annotations

import argparse
import gc
import html
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import gradio as gr
import requests
import torch

from indextts.infer_v2_5 import IndexTTS2
from text_director import (
    CONTENT_TYPES,
    CONTENT_TYPE_LABELS,
    DirectorCancelled,
    DirectorConfig,
    DirectorError,
    OllamaTextDirector,
    ROLE_HEADERS,
    SEGMENT_HEADERS,
    apply_generated_voices,
    build_voice_design_jobs,
    document_to_tables,
    render_directed_audio,
    voice_catalog_markdown,
)


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "outputs" / "production"
DIRECTOR_OUTPUT_DIR = ROOT / "outputs" / "director"
ROLE_VOICE_OUTPUT_DIR = ROOT / "outputs" / "role-voices"
TASK_OUTPUT_DIR = ROOT / "runtime-output" / "director-tasks"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DIRECTOR_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ROLE_VOICE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TASK_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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
    parser.add_argument("--ai-model", default=os.getenv("INDEXTTS_AI_MODEL", "qwen3:8b"))
    parser.add_argument("--ai-timeout", type=int, default=int(os.getenv("INDEXTTS_AI_TIMEOUT", "300")))
    parser.add_argument("--ai-chunk-chars", type=int, default=int(os.getenv("INDEXTTS_AI_CHUNK_CHARS", "1400")))
    parser.add_argument(
        "--voice-design-python",
        default=os.getenv("INDEXTTS_VOICE_DESIGN_PYTHON", str(ROOT / ".venv-voice-design" / "Scripts" / "python.exe")),
    )
    parser.add_argument(
        "--voice-design-model",
        default=os.getenv(
            "INDEXTTS_VOICE_DESIGN_MODEL",
            str(ROOT / "checkpoints" / "Qwen3-TTS-12Hz-1.7B-VoiceDesign"),
        ),
    )
    return parser.parse_args()


ARGS = parse_args()
MODEL_DIR = Path(ARGS.model_dir).resolve()
def _create_indextts_model() -> IndexTTS2:
    return IndexTTS2(
        cfg_path=str(MODEL_DIR / "config.yaml"),
        model_dir=str(MODEL_DIR),
        use_bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        use_cuda_kernel=False,
        use_deepspeed=False,
        use_accel=False,
        use_torch_compile=False,
        use_qwen_emo=True,
    )


MODEL = _create_indextts_model()
MODEL_LOCK = threading.Lock()
TASK_LOCK = threading.Lock()
ACTIVE_TASKS: dict[str, dict] = {}
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
VOICE_STRATEGIES = ["AI 设计全新角色音色", "智能匹配内置音色", "使用表格中的音色"]


def _activity(title: str, detail: str, fraction: float = 0.0, tone: str = "working") -> str:
    percent = max(0, min(100, round(float(fraction) * 100)))
    safe_title = html.escape(title)
    safe_detail = html.escape(detail)
    return (
        f"<div class='activity-card {tone}'><div class='activity-head'><strong>{safe_title}</strong>"
        f"<span>{percent}%</span></div><div class='activity-detail'>{safe_detail}</div>"
        f"<div class='activity-track'><i style='width:{percent}%'></i></div></div>"
    )


def _read_json(path: Path) -> dict:
    for _ in range(3):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, PermissionError):
            time.sleep(0.05)
    return {}


def _stop_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _register_task(task_id: str, payload: dict) -> None:
    with TASK_LOCK:
        ACTIVE_TASKS[task_id] = payload


def _pop_task(task_id: str) -> dict | None:
    with TASK_LOCK:
        return ACTIVE_TASKS.pop(task_id, None)


def _cancel_task(task_id: str) -> bool:
    with TASK_LOCK:
        task = ACTIVE_TASKS.get(task_id or "")
    if not task:
        return False
    cancel_event = task.get("cancel_event")
    if cancel_event is not None:
        cancel_event.set()
    _stop_process(task.get("process"))
    worker = task.get("worker")
    if worker is not None and worker.is_alive():
        worker.join()
    for key in ("task_dir", "partial_output_dir"):
        path = task.get(key)
        if path:
            shutil.rmtree(Path(path), ignore_errors=True)
    if task.get("restore_indextts"):
        _restore_indextts_model()
    _pop_task(task_id)
    return True


def _unload_ollama_model() -> None:
    try:
        requests.post(
            f"{ARGS.ai_base_url.rstrip('/')}/api/generate",
            json={"model": ARGS.ai_model, "keep_alive": 0},
            timeout=20,
        ).raise_for_status()
    except requests.RequestException as exc:
        raise DirectorError(f"释放文本模型显存失败：{exc}") from exc


def _release_indextts_model() -> None:
    global MODEL
    with MODEL_LOCK:
        MODEL = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()


def _restore_indextts_model() -> None:
    global MODEL
    with MODEL_LOCK:
        if MODEL is None:
            MODEL = _create_indextts_model()


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
    yield None, _activity("准备单句生成", "正在校验文本与参考音频", 0.03), gr.update(value="正在生成", interactive=False)

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
    try:
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
    except Exception as exc:
        yield None, _activity("单句生成失败", str(exc), 1.0, "cancelled"), gr.update(value="生成语音", interactive=True)
        return
    elapsed = time.perf_counter() - started
    if not result or not output_path.exists():
        raise gr.Error("生成未产生有效音频，请调整文本或参考音频后重试。")
    status = (
        f"<div class='result-meta'><span>生成完成</span>"
        f"<strong>{elapsed:.1f} 秒</strong><span>{language_label}</span>"
        f"<span>{emotion_mode}</span><span>时长系数 {duration_factor:.2f}</span></div>"
    )
    yield str(output_path), status, gr.update(value="生成语音", interactive=True)


def analyze_director_document(
    content_type_label: str,
    source_text: str,
    guidance: str,
):
    task_id = uuid.uuid4().hex
    task_dir = TASK_OUTPUT_DIR / task_id
    task_dir.mkdir(parents=True, exist_ok=False)
    input_path = task_dir / "input.json"
    result_path = task_dir / "result.json"
    status_path = task_dir / "status.json"
    log_path = task_dir / "worker.log"
    process = None
    error_message = ""
    indextts_released = False
    task_payload = {
        "process": None,
        "kind": "analysis",
        "task_dir": task_dir,
        "restore_indextts": False,
    }
    _register_task(task_id, task_payload)
    yield (
        {}, [], [], "", "正在启动 AI 文本导演。",
        _activity("AI 文本导演", "正在启动独立分析任务", 0.01),
        gr.update(value="正在分析", interactive=False), gr.update(visible=True), task_id,
    )
    try:
        content_type = CONTENT_TYPES.get(content_type_label)
        if content_type is None:
            raise DirectorError(f"不支持的内容体裁：{content_type_label}")
        input_path.write_text(
            json.dumps(
                {
                    "config": {
                        "base_url": ARGS.ai_base_url,
                        "model": ARGS.ai_model,
                        "timeout_seconds": ARGS.ai_timeout,
                        "max_chunk_chars": ARGS.ai_chunk_chars,
                    },
                    "source_text": source_text,
                    "content_type": content_type,
                    "guidance": guidance,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        task_payload["restore_indextts"] = True
        _release_indextts_model()
        indextts_released = True
        yield (
            {}, [], [], "", "AI 正在处理全文。",
            _activity("AI 文本导演", "已释放音频模型，正在为长文本准备完整 GPU 资源", 0.02),
            gr.update(value="正在分析", interactive=False), gr.update(visible=True), task_id,
        )
        with log_path.open("w", encoding="utf-8") as log_file:
            process = subprocess.Popen(
                [
                    sys.executable, str(ROOT / "text_director_worker.py"),
                    "--input", str(input_path), "--result", str(result_path), "--status", str(status_path),
                ],
                cwd=str(ROOT), stdout=log_file, stderr=subprocess.STDOUT,
            )
            task_payload["process"] = process
            last_status = None
            while process.poll() is None:
                current = _read_json(status_path)
                signature = (current.get("phase"), current.get("fraction"), current.get("message"))
                if current and signature != last_status:
                    last_status = signature
                    yield (
                        {}, [], [], "", "AI 正在处理全文。",
                        _activity("AI 文本导演", current.get("message", "正在分析文本"), current.get("fraction", 0.05)),
                        gr.update(value="正在分析", interactive=False), gr.update(visible=True), task_id,
                    )
                time.sleep(0.25)
        if process.returncode != 0:
            status = _read_json(status_path)
            detail = status.get("message") or log_path.read_text(encoding="utf-8", errors="replace")[-1000:]
            raise DirectorError(f"AI 文本导演失败：{detail}")
        document = _read_json(result_path)
        if not document.get("segments"):
            raise DirectorError("AI 文本导演没有返回有效分句。")
        role_rows, segment_rows = document_to_tables(document, DEMO_VOICES)
        yield (
            document, role_rows, segment_rows, document["cleaned_text"],
            f"### AI 已完成长文本分轨\n\n已生成 {len(role_rows)} 条角色轨道和 {len(segment_rows)} 条分句，正在恢复音频生成模型。",
            _activity("AI 文本导演", "长文本分轨已经完成，正在恢复 IndexTTS 音频模型", 0.99),
            gr.update(value="正在恢复音频模型", interactive=False), gr.update(visible=False), task_id,
        )
    except DirectorError as exc:
        error_message = str(exc)
    finally:
        _stop_process(process)
        if indextts_released:
            try:
                _restore_indextts_model()
                task_payload["restore_indextts"] = False
            except Exception as exc:
                error_message = f"文本分析已经结束，IndexTTS 模型恢复失败：{exc}"
        _pop_task(task_id)
        shutil.rmtree(task_dir, ignore_errors=True)
    if error_message:
        yield (
            {}, [], [], "", f"### AI 导演失败\n\n{html.escape(error_message)}",
            _activity("AI 文本导演失败", error_message, 1.0, "cancelled"),
            gr.update(value="AI 清洗并分段分句分轨", interactive=True), gr.update(visible=False), "",
        )
        return
    metrics = document["metrics"]
    detected_label = CONTENT_TYPE_LABELS.get(document["content_type"], document["content_type"])
    summary = (
        f"### AI 导演完成\n\n**标题**　{html.escape(document['title'])}\n\n"
        f"**体裁**　{detected_label}　　**角色轨道**　{len(role_rows)}　　"
        f"**合成分句**　{len(segment_rows)}　　**原文覆盖**　100%\n\n"
        f"**AI**　Ollama {ARGS.ai_model}　　**文本块**　{metrics['chunks']}　　"
        f"**Token**　{metrics['prompt_tokens']} → {metrics['output_tokens']}　　"
        f"**耗时**　{metrics['duration_seconds']:.1f} 秒"
    )
    yield (
        document, role_rows, segment_rows, document["cleaned_text"], summary,
        _activity("AI 文本导演完成", "角色、分句和原文覆盖校验均已完成", 1.0, "complete"),
        gr.update(value="AI 清洗并分段分句分轨", interactive=True), gr.update(visible=False), "",
    )


def cancel_active_task(task_id: str, label: str, button_label: str):
    cancelled = _cancel_task(task_id)
    detail = f"{label}已取消，后台任务已停止。" if cancelled else f"{label}已经结束。"
    return (
        _activity(label, detail, 1.0, "cancelled"),
        gr.update(visible=False),
        "",
        gr.update(value=button_label, interactive=True, visible=True),
    )


def cancel_analysis_task(task_id: str):
    result = cancel_active_task(task_id, "AI 文本导演", "AI 清洗并分段分句分轨")
    return (*result, "AI 文本导演已取消，后台分析任务已经停止。")


def cancel_render_task(task_id: str):
    result = cancel_active_task(task_id, "完整音频生成", "按角色音色生成完整音频")
    return (*result, "完整音频生成已取消，未完成输出已经清理。")


def generate_role_voices(document: dict | None, role_table, strategy: str):
    if not document or not document.get("characters"):
        raise gr.Error("请先完成 AI 文本导演分析。")
    if strategy == "使用表格中的音色":
        yield role_table, [], gr.update(choices=[], value=None), None, _activity("角色音色", "继续使用表格中的音色配置", 1.0, "complete"), gr.update(value="生成或更新角色音色", interactive=True), gr.update(visible=False), ""
        return
    if strategy == "智能匹配内置音色":
        matched, _ = document_to_tables(document, DEMO_VOICES)
        yield matched, [], gr.update(choices=[], value=None), None, _activity("角色音色", "已按角色特征匹配内置中文音色", 1.0, "complete"), gr.update(value="生成或更新角色音色", interactive=True), gr.update(visible=False), ""
        return

    jobs = build_voice_design_jobs(document, role_table)
    task_id = uuid.uuid4().hex
    task_dir = TASK_OUTPUT_DIR / task_id
    task_dir.mkdir(parents=True, exist_ok=False)
    voice_dir = ROLE_VOICE_OUTPUT_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    input_path, result_path, status_path = task_dir / "input.json", task_dir / "result.json", task_dir / "status.json"
    log_path = task_dir / "worker.log"
    process = None
    error_message = ""
    indextts_released = False
    task_payload = {
        "process": None,
        "kind": "voice-design",
        "task_dir": task_dir,
        "partial_output_dir": voice_dir,
        "restore_indextts": False,
    }
    _register_task(task_id, task_payload)
    yield role_table, [], gr.update(choices=[], value=None), None, _activity("AI 角色音色", "正在释放文本模型显存", 0.01), gr.update(value="正在设计音色", interactive=False), gr.update(visible=True), task_id
    try:
        voice_python = Path(ARGS.voice_design_python)
        model_dir = Path(ARGS.voice_design_model)
        if not voice_python.is_file() or not (model_dir / "config.json").is_file():
            raise DirectorError("AI 音色设计环境尚未就绪，请先运行 scripts/setup_voice_design_windows.ps1。")
        _unload_ollama_model()
        task_payload["restore_indextts"] = True
        _release_indextts_model()
        indextts_released = True
        input_path.write_text(json.dumps({"jobs": jobs, "output_dir": str(voice_dir), "model_dir": str(model_dir), "seed": 42}, ensure_ascii=False), encoding="utf-8")
        with log_path.open("w", encoding="utf-8") as log_file:
            process = subprocess.Popen([str(voice_python), str(ROOT / "voice_design_worker.py"), "--input", str(input_path), "--result", str(result_path), "--status", str(status_path)], cwd=str(ROOT), stdout=log_file, stderr=subprocess.STDOUT)
            task_payload["process"] = process
            last_status = None
            while process.poll() is None:
                current = _read_json(status_path)
                signature = (current.get("phase"), current.get("fraction"), current.get("message"))
                if current and signature != last_status:
                    last_status = signature
                    yield role_table, [], gr.update(), None, _activity("AI 角色音色", current.get("message", "正在生成角色音色"), current.get("fraction", 0.05)), gr.update(value="正在设计音色", interactive=False), gr.update(visible=True), task_id
                time.sleep(0.25)
        if process.returncode != 0:
            status = _read_json(status_path)
            detail = status.get("message") or log_path.read_text(encoding="utf-8", errors="replace")[-1000:]
            raise DirectorError(f"AI 角色音色生成失败：{detail}")
        result = _read_json(result_path)
        generated = result.get("generated") or []
        updated_roles = apply_generated_voices(role_table, generated)
        files = [item["path"] for item in generated]
        choices = [(f"{item['name']}｜{Path(item['path']).name}", item["path"]) for item in generated]
        yield updated_roles, files, gr.update(choices=choices, value=choices[0][1] if choices else None), choices[0][1] if choices else None, _activity("AI 角色音色", "正在恢复 IndexTTS 音频生成模型", 0.97), gr.update(value="正在恢复音频模型", interactive=False), gr.update(visible=False), task_id
    except DirectorError as exc:
        error_message = str(exc)
        shutil.rmtree(voice_dir, ignore_errors=True)
    finally:
        _stop_process(process)
        _pop_task(task_id)
        shutil.rmtree(task_dir, ignore_errors=True)
        if indextts_released:
            try:
                _restore_indextts_model()
                task_payload["restore_indextts"] = False
            except Exception as exc:
                error_message = f"角色音色已经生成，IndexTTS 模型恢复失败：{exc}"
    if error_message:
        yield role_table, [], gr.update(choices=[], value=None), None, _activity("AI 角色音色失败", error_message, 1.0, "cancelled"), gr.update(value="生成或更新角色音色", interactive=True), gr.update(visible=False), ""
        return
    yield updated_roles, files, gr.update(choices=choices, value=choices[0][1] if choices else None), choices[0][1] if choices else None, _activity("AI 角色音色完成", f"已生成 {len(files)} 条可复用角色参考音频", 1.0, "complete"), gr.update(value="生成或更新角色音色", interactive=True), gr.update(visible=False), ""


def preview_role_voice(path: str | None):
    return path


def generate_directed_project(
    document: dict | None,
    role_table,
    segment_table,
    uploaded_voices: list[str] | None,
    generated_voices: list[str] | None,
):
    if not document or not document.get("segments"):
        raise gr.Error("请先完成 AI 文本导演分析。")
    task_id = uuid.uuid4().hex
    cancel_event = threading.Event()
    updates: queue.Queue = queue.Queue()
    result: dict = {}

    def progress(fraction: float, desc: str = "", description: str = "") -> None:
        updates.put((float(fraction), desc or description or "正在生成分句音频"))

    def run() -> None:
        try:
            result["value"] = render_directed_audio(
                document=document, role_table=role_table, segment_table=segment_table,
                uploaded_files=uploaded_voices, generated_files=generated_voices,
                model=MODEL, model_lock=MODEL_LOCK, output_root=DIRECTOR_OUTPUT_DIR,
                demo_dir=ROOT / "examples", demo_voices=DEMO_VOICES,
                progress=progress, cancel_event=cancel_event,
            )
        except Exception as exc:
            result["error"] = exc

    worker = threading.Thread(target=run, name=f"director-render-{task_id}", daemon=True)
    _register_task(task_id, {"cancel_event": cancel_event, "kind": "render", "worker": worker})
    worker.start()
    yield None, None, None, "正在准备长篇音频生成。", _activity("完整音频", "正在准备模型和角色音色", 0.01), gr.update(value="正在生成完整音频", interactive=False), gr.update(visible=True), task_id
    last = None
    try:
        while worker.is_alive():
            try:
                while True:
                    last = updates.get_nowait()
            except queue.Empty:
                pass
            if last:
                yield None, None, None, f"正在生成：{last[1]}", _activity("完整音频", last[1], last[0]), gr.update(value="正在生成完整音频", interactive=False), gr.update(visible=True), task_id
            worker.join(timeout=0.25)
        if result.get("error"):
            error = result["error"]
            if isinstance(error, DirectorCancelled):
                message = "完整音频生成已取消，未完成目录已清理。"
                yield None, None, None, message, _activity("完整音频已取消", message, 1.0, "cancelled"), gr.update(value="按角色音色生成完整音频", interactive=True), gr.update(visible=False), ""
                return
            if isinstance(error, DirectorError):
                message = str(error)
                yield None, None, None, f"### 长篇音频生成失败\n\n{message}", _activity("完整音频生成失败", message, 1.0, "cancelled"), gr.update(value="按角色音色生成完整音频", interactive=True), gr.update(visible=False), ""
                return
            raise error
        master, package, manifest, status = result["value"]
    finally:
        _pop_task(task_id)
    yield master, package, manifest, f"### 长篇音频生成完成\n\n{status}", _activity("完整音频完成", "完整 WAV、角色轨道和交付包已经生成", 1.0, "complete"), gr.update(value="按角色音色生成完整音频", interactive=True), gr.update(visible=False), ""


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
.director-table .table-wrap { overflow-x:auto !important; }
.director-table table { min-width:1180px !important; table-layout:fixed !important; }
.director-table th, .director-table td { white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important; }
.director-table textarea { white-space:normal !important; overflow-wrap:normal !important; word-break:normal !important; }
.activity-card { border:1px solid #ffd5c0; background:#fff8f4; border-radius:8px; padding:12px 14px; margin:10px 0; }
.activity-head { display:flex; justify-content:space-between; gap:16px; color:#9c3f13; }
.activity-detail { color:var(--studio-muted); font-size:12px; margin:7px 0 9px; }
.activity-track { height:5px; background:#f1e2db; border-radius:999px; overflow:hidden; }
.activity-track i { display:block; height:100%; background:var(--studio-orange); transition:width .2s ease; }
.activity-card.complete { border-color:#bee1c8; background:#f3fbf5; }
.activity-card.complete .activity-head { color:#34734a; }
.activity-card.cancelled { border-color:#d9dde1; background:#f7f8fa; }
.studio-cancel { min-height:42px !important; }
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
                director_task_state = gr.State("")
                voice_task_state = gr.State("")
                render_task_state = gr.State("")
                generated_voice_state = gr.State([])
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
                        director_activity = gr.HTML(_activity("AI 文本导演", "等待提交全文", 0.0, "idle"))
                        with gr.Row():
                            director_analyze = gr.Button("AI 清洗并分段分句分轨", variant="primary", elem_classes="studio-primary")
                            director_cancel = gr.Button("取消分析", visible=False, elem_classes="studio-cancel")
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
                    voice_strategy = gr.Radio(
                        VOICE_STRATEGIES,
                        value=VOICE_STRATEGIES[0],
                        label="音色策略",
                        info="AI 设计会生成可复用的新角色音色，智能匹配会直接选择现有中文音色。",
                    )
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
                        wrap=False,
                        column_widths=[130, 110, 110, 360, 180],
                        pinned_columns=2,
                        show_search="filter",
                        elem_classes="director-table",
                    )
                    voice_activity = gr.HTML(_activity("角色音色", "等待选择策略", 0.0, "idle"))
                    with gr.Row():
                        voice_generate = gr.Button("生成或更新角色音色", variant="primary", elem_classes="studio-primary")
                        voice_cancel = gr.Button("取消音色设计", visible=False, elem_classes="studio-cancel")
                    with gr.Row():
                        role_voice_preview_choice = gr.Dropdown(label="角色音色试听", choices=[], interactive=True)
                        role_voice_preview = gr.Audio(label="生成音色预览", type="filepath")

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
                        wrap=False,
                        column_widths=[70, 120, 130, 100, 80, 280, 280, 180, 110, 100, 90, 120],
                        pinned_columns=5,
                        show_search="filter",
                        static_columns=[0],
                        elem_classes="director-table",
                    )
                    render_activity = gr.HTML(_activity("完整音频", "等待导演表和角色音色", 0.0, "idle"))
                    with gr.Row():
                        director_generate = gr.Button("按角色音色生成完整音频", variant="primary", elem_classes="studio-primary")
                        render_cancel = gr.Button("取消完整音频生成", visible=False, elem_classes="studio-cancel")

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
            outputs=[output_audio, result_status, generate],
            show_progress="hidden",
        )
        analysis_event = director_analyze.click(
            analyze_director_document,
            inputs=[director_content_type, director_source, director_guidance],
            outputs=[director_state, director_roles, director_segments, director_cleaned, director_summary, director_activity, director_analyze, director_cancel, director_task_state],
            show_progress="hidden",
        )
        director_cancel.click(
            cancel_analysis_task,
            inputs=[director_task_state],
            outputs=[director_activity, director_cancel, director_task_state, director_analyze, director_summary],
            cancels=[analysis_event], queue=False, show_progress="hidden",
        )
        voice_event = voice_generate.click(
            generate_role_voices,
            inputs=[director_state, director_roles, voice_strategy],
            outputs=[director_roles, generated_voice_state, role_voice_preview_choice, role_voice_preview, voice_activity, voice_generate, voice_cancel, voice_task_state],
            show_progress="hidden",
        )
        voice_cancel.click(
            cancel_active_task,
            inputs=[voice_task_state, gr.State("AI 角色音色"), gr.State("生成或更新角色音色")],
            outputs=[voice_activity, voice_cancel, voice_task_state, voice_generate],
            cancels=[voice_event], queue=False, show_progress="hidden",
        )
        role_voice_preview_choice.change(preview_role_voice, role_voice_preview_choice, role_voice_preview, show_progress="hidden")
        render_event = director_generate.click(
            generate_directed_project,
            inputs=[director_state, director_roles, director_segments, director_uploaded_voices, generated_voice_state],
            outputs=[director_master, director_package, director_manifest, director_render_status, render_activity, director_generate, render_cancel, render_task_state],
            show_progress="hidden",
        )
        render_cancel.click(
            cancel_render_task,
            inputs=[render_task_state],
            outputs=[render_activity, render_cancel, render_task_state, director_generate, director_render_status],
            cancels=[render_event], queue=False, show_progress="hidden",
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
