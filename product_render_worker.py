from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from voice_design_daemon_client import release_voice_design_model
from render_daemon_client import enqueue_render_request, ensure_render_daemon, read_render_state
from voice_design_daemon_client import process_alive
from runtime_python import main_python
from standard_reference import (
    ECHO_SIMILARITY_THRESHOLD,
    SPEAKER_SIMILARITY_THRESHOLD,
    STANDARD_REFERENCE_CANDIDATE_COUNT,
    STANDARD_REFERENCE_MAX_ATTEMPTS,
    STANDARD_REFERENCE_PACES,
    cleanup_unreferenced_standard_voices,
    delayed_echo_similarity,
    register_standard_voice,
    standard_reference_score,
)


MIN_AVAILABLE_MEMORY_BYTES = 2 * 1024**3


def write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def linux_memavailable_bytes(meminfo: str) -> int | None:
    for line in meminfo.splitlines():
        if line.startswith("MemAvailable:"):
            try:
                available_kib = int(line.split()[1])
            except (ValueError, IndexError):
                return None
            return available_kib * 1024 if available_kib > 0 else None
    return None


def available_memory_bytes() -> int | None:
    if os.name == "nt":
        import ctypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("length", ctypes.c_ulong),
                ("memory_load", ctypes.c_ulong),
                ("total_physical", ctypes.c_ulonglong),
                ("available_physical", ctypes.c_ulonglong),
                ("total_page_file", ctypes.c_ulonglong),
                ("available_page_file", ctypes.c_ulonglong),
                ("total_virtual", ctypes.c_ulonglong),
                ("available_virtual", ctypes.c_ulonglong),
                ("available_extended_virtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatus()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.available_physical)
        return None
    try:
        available = linux_memavailable_bytes(Path("/proc/meminfo").read_text(encoding="utf-8"))
        if available is not None:
            return available
    except OSError:
        pass
    try:
        return int(os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"))
    except (AttributeError, OSError, ValueError):
        return None


def _load_render_dependencies() -> tuple[Any, Any, Any, Any, Any]:
    import torch
    from indextts.infer_v2_5 import IndexTTS2
    from novel_project import NovelProjectStore, pronunciation_rows
    from text_director import render_directed_audio

    return torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio


def prepare_render_environment(root: Path, status_path: Path) -> tuple[Any, Any, Any, Any, Any]:
    write_json(status_path, {"phase": "preparing", "fraction": 0.005, "message": "正在释放音色设计模型，为完整渲染准备内存"})
    release_voice_design_model(root)
    available = available_memory_bytes()
    if available is not None and available < MIN_AVAILABLE_MEMORY_BYTES:
        available_gib = available / 1024**3
        raise RuntimeError(f"完整渲染可用内存不足：当前 {available_gib:.1f} GiB，至少需要 2.0 GiB，请先释放主机内存后重试")
    write_json(status_path, {"phase": "importing", "fraction": 0.01, "message": "正在加载 PyTorch CUDA 运行库"})
    return _load_render_dependencies()


class RenderRuntime:
    def __init__(self) -> None:
        self.dependencies: tuple[Any, Any, Any, Any, Any] | None = None
        self.model: Any | None = None
        self.torch: Any | None = None
        self.model_lock = threading.Lock()

    def release(self) -> bool:
        had_model = self.model is not None
        torch = self.torch
        self.model = None
        gc.collect()
        if torch is not None:
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
            except Exception:
                pass
        return had_model

    def get_model(self, root: Path, status_path: Path) -> tuple[Any, Any, Any, Any, Any, Any, bool]:
        if self.model is not None and self.dependencies is not None:
            write_json(status_path, {"phase": "model_ready", "fraction": 0.02, "message": "正在复用已驻留的 IndexTTS 2.5"})
            torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio = self.dependencies
            return torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio, self.model, True
        if self.dependencies is None:
            self.dependencies = prepare_render_environment(root, status_path)
        else:
            write_json(status_path, {"phase": "preparing", "fraction": 0.005, "message": "正在释放音色设计模型，为合成模型准备内存"})
            release_voice_design_model(root)
            available = available_memory_bytes()
            if available is not None and available < MIN_AVAILABLE_MEMORY_BYTES:
                raise RuntimeError(f"合成模型可用内存不足：当前 {available / 1024**3:.1f} GiB，至少需要 2.0 GiB")
        torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio = self.dependencies
        model_dir = root / "checkpoints"
        write_json(status_path, {"phase": "loading", "fraction": 0.02, "message": "正在加载 IndexTTS 2.5"})
        self.model = IndexTTS2(
            cfg_path=str(model_dir / "config.yaml"), model_dir=str(model_dir),
            use_bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
            use_cuda_kernel=False, use_deepspeed=False, use_accel=False,
            use_torch_compile=False, use_qwen_emo=True,
        )
        self.torch = torch
        return torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio, self.model, False


def execute_standard_reference_request(
    request: dict[str, Any],
    result_path: Path,
    status_path: Path,
    runtime: RenderRuntime,
) -> dict[str, Any]:
    root = Path(request["root"]).resolve()
    options = request.get("standard_reference") or {}
    role_id = str(options.get("role_id") or "").strip()
    pace_preset = str(options.get("pace_preset") or "舒缓")
    if pace_preset not in STANDARD_REFERENCE_PACES:
        raise ValueError("标准参考样本节奏无效")
    audition_text = str(options.get("audition_text") or "").strip()
    if not 10 <= len(audition_text) <= 500:
        raise ValueError("标准参考样本试听文本必须在 10 至 500 字符之间")

    _, _, NovelProjectStore, _, _, model, model_reused = runtime.get_model(root, status_path)
    from text_director import analyze_segment_candidate

    store = NovelProjectStore(root / "outputs" / "novel-projects", root / "outputs" / "voice-library")
    project = store.load(request["project_id"])
    role = next((row for row in project.get("roles") or [] if str(row[0]) == role_id), None)
    if role is None:
        raise ValueError("角色不存在")
    asset = (project.get("character_assets") or {}).get(role_id) or {}
    source_voice_id = str((asset.get("reference_audio") or {}).get("voice_id") or "").strip()
    if not source_voice_id:
        raise ValueError("请先上传并保存原始参考音频")
    source_path = (root / "outputs" / "voice-library" / f"{Path(source_voice_id).stem}.wav").resolve()
    if not source_path.is_file():
        raise ValueError("原始参考音频文件不存在，请重新上传")

    pace = STANDARD_REFERENCE_PACES[pace_preset]
    run_id = hashlib.sha256(f"{request['project_id']}:{role_id}:{time.time_ns()}".encode("utf-8")).hexdigest()[:16]
    staging = store.project_dir(project["project_id"]) / "process" / "standard-reference-staging" / run_id
    staging.mkdir(parents=True, exist_ok=False)
    generated: list[tuple[Path, dict[str, Any]]] = []
    try:
        with runtime.model_lock:
            for attempt in range(STANDARD_REFERENCE_MAX_ATTEMPTS):
                write_json(status_path, {
                    "phase": "standardizing",
                    "fraction": 0.05 + attempt / STANDARD_REFERENCE_MAX_ATTEMPTS * 0.82,
                    "message": f"正在生成并检查标准参考样本 {attempt + 1}/{STANDARD_REFERENCE_MAX_ATTEMPTS}",
                })
                candidate_path = staging / f"candidate-{attempt + 1}.wav"
                result = model.infer(
                    spk_audio_prompt=str(source_path),
                    text=audition_text,
                    lang=str(options.get("language") or "ZH"),
                    output_path=str(candidate_path),
                    emo_audio_prompt=None,
                    emo_alpha=0.45,
                    emo_vector=None,
                    use_emo_text=True,
                    emo_text=f"{pace['prompt']}保持原始说话人的音色身份，单人干声，避免回音、重叠人声和夸张变声。",
                    use_random=True,
                    duration_factor=float(pace["duration_factor"]),
                    max_text_tokens_per_segment=120,
                    verbose=False,
                )
                if not result or not candidate_path.is_file():
                    continue
                metrics = analyze_segment_candidate(candidate_path, audition_text)
                metrics["audio_quality_passed"] = bool(metrics["quality_passed"])
                similarity = float(model.speaker_similarity(str(source_path), str(candidate_path)))
                metrics["speaker_similarity"] = round(similarity, 6)
                metrics["speaker_similarity_threshold"] = SPEAKER_SIMILARITY_THRESHOLD
                metrics["speaker_verified"] = similarity >= SPEAKER_SIMILARITY_THRESHOLD
                echo_similarity = delayed_echo_similarity(candidate_path)
                metrics["echo_similarity"] = echo_similarity
                metrics["echo_threshold"] = ECHO_SIMILARITY_THRESHOLD
                metrics["echo_verified"] = echo_similarity <= ECHO_SIMILARITY_THRESHOLD
                metrics["quality_passed"] = bool(
                    metrics["audio_quality_passed"]
                    and metrics["speaker_verified"]
                    and metrics["echo_verified"]
                )
                metrics["score"] = standard_reference_score(metrics)
                generated.append((candidate_path, metrics))
                passing = [item for item in generated if item[1]["quality_passed"]]
                if len(passing) >= STANDARD_REFERENCE_CANDIDATE_COUNT:
                    break

        passing = [item for item in generated if item[1]["quality_passed"]]
        attempt_audit = [
            {"attempt": index, **metrics}
            for index, (_, metrics) in enumerate(generated, start=1)
        ]
        audit_payload = {
            "role_id": role_id,
            "source_voice_id": source_voice_id,
            "candidate_count": 0,
            "passing_count": len(passing),
            "attempt_count": len(generated),
            "attempt_audit": attempt_audit,
        }
        write_json(result_path, audit_payload)
        if len(passing) < STANDARD_REFERENCE_CANDIDATE_COUNT:
            raise RuntimeError(
                f"连续 {len(generated)} 次生成后只有 {len(passing)} 个候选通过全部自动门禁，"
                f"需要 {STANDARD_REFERENCE_CANDIDATE_COUNT} 个，请重新生成或更换原始样本"
            )
        selected = sorted(passing, key=lambda item: float(item[1]["score"]), reverse=True)[:STANDARD_REFERENCE_CANDIDATE_COUNT]

        generated_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        candidates = []
        for rank, (candidate_path, metrics) in enumerate(selected, start=1):
            voice_id = register_standard_voice(root / "outputs" / "voice-library", candidate_path, {
                "project_id": project["project_id"],
                "role_id": role_id,
                "role_name": str(role[1]),
                "source_voice_id": source_voice_id,
                "audition_text": audition_text,
                "pace_preset": pace_preset,
                "duration_factor": float(pace["duration_factor"]),
                "rank": rank,
                "metrics": metrics,
            })
            candidates.append({
                "voice_id": voice_id,
                "rank": rank,
                "duration_seconds": float(metrics.get("duration_seconds") or 0),
                "audio_quality_passed": bool(metrics["audio_quality_passed"]),
                "speaker_similarity": float(metrics["speaker_similarity"]),
                "speaker_similarity_threshold": SPEAKER_SIMILARITY_THRESHOLD,
                "speaker_verified": bool(metrics["speaker_verified"]),
                "echo_similarity": float(metrics["echo_similarity"]),
                "echo_threshold": ECHO_SIMILARITY_THRESHOLD,
                "echo_verified": bool(metrics["echo_verified"]),
                "quality_passed": bool(metrics["quality_passed"]),
                "score": float(metrics["score"]),
                "selected": False,
                "generated_at": generated_at,
            })

        previous = asset.get("standard_reference") or {}
        old_unselected = [
            str(item.get("voice_id") or "")
            for item in previous.get("candidates") or []
            if not item.get("selected")
        ]
        asset["standard_reference"] = {
            "source_voice_id": source_voice_id,
            "audition_text": audition_text,
            "pace_preset": pace_preset,
            "duration_factor": float(pace["duration_factor"]),
            "generated_at": generated_at,
            "candidates": candidates,
            **({"adopted_voice_id": previous["adopted_voice_id"]} if previous.get("adopted_voice_id") else {}),
            **({"adopted_at": previous["adopted_at"]} if previous.get("adopted_at") else {}),
            **({"restored_at": previous["restored_at"]} if previous.get("restored_at") else {}),
        }
        project.setdefault("character_assets", {})[role_id] = asset
        saved = store.save(
            project["project_id"], title=project.get("title", ""), content_type=project.get("content_type", "novel"),
            source_text=project.get("source_text", ""), guidance=project.get("guidance", ""), document=project.get("document") or {},
            roles=project.get("roles") or [], segments=project.get("segments") or [], pronunciations=project.get("pronunciations") or [],
            voice_files=project.get("voice_files") or [], character_assets=project.get("character_assets") or {},
            director_history=project.get("director_history") or [], director_memory=project.get("director_memory") or {},
        )
        removed = cleanup_unreferenced_standard_voices(store.root, store.voice_library_root, old_unselected)
        payload = {
            "role_id": role_id,
            "source_voice_id": source_voice_id,
            "candidate_count": len(candidates),
            "passing_count": sum(1 for item in candidates if item["quality_passed"]),
            "attempt_count": len(generated),
            "attempt_audit": attempt_audit,
            "removed_unreferenced_candidates": removed,
            "render_runtime": {"model_reused": model_reused, "resident": True, "pid": os.getpid()},
            "updated_at": saved.get("updated_at"),
        }
        write_json(result_path, payload)
        write_json(status_path, {
            "phase": "complete",
            "fraction": 1.0,
            "message": f"已生成 {len(candidates)} 个通过全部自动门禁的标准参考候选，请 A/B 试听后采用",
        })
        return payload
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def execute_render_request(request: dict[str, Any], result_path: Path, status_path: Path, runtime: RenderRuntime | None = None) -> dict[str, Any]:
    if request.get("standard_reference"):
        return execute_standard_reference_request(request, result_path, status_path, runtime or RenderRuntime())
    root = Path(request["root"]).resolve()
    cache_only = bool(request.get("cache_only"))
    if cache_only:
        from novel_project import NovelProjectStore, pronunciation_rows
        from text_director import render_directed_audio

        torch = IndexTTS2 = None
        model_reused = False
        write_json(status_path, {"phase": "assembling", "fraction": 0.01, "message": "正在校验并串接全部已生成片断"})
    else:
        runtime = runtime or RenderRuntime()
        torch, IndexTTS2, NovelProjectStore, pronunciation_rows, render_directed_audio, model, model_reused = runtime.get_model(root, status_path)
    store = NovelProjectStore(root / "outputs" / "novel-projects", root / "outputs" / "voice-library")
    project = store.load(request["project_id"])
    if cache_only:
        model = object()
    def progress(fraction: float, desc: str = "", description: str = "") -> None:
        write_json(status_path, {"phase": "rendering", "fraction": fraction, "message": desc or description})
    master, package, manifest, summary = render_directed_audio(
        document=project.get("document") or {"title": project.get("title", "小说工程")},
        role_table=project["roles"], segment_table=project["segments"],
        pronunciation_table=pronunciation_rows(project.get("pronunciations")),
        uploaded_files=project.get("voice_files") or [], model=model, model_lock=runtime.model_lock if runtime else threading.Lock(),
        output_root=store.project_dir(project["project_id"]) / "renders",
        project_process_dir=store.project_dir(project["project_id"]) / "process",
        force_segment_orders=request.get("force_segment_orders") or [],
        fragment_only_orders=request.get("fragment_only_orders") or [],
        advanced_segment_orders=request.get("advanced_segment_orders") or [],
        cache_only=cache_only,
        demo_dir=root / "examples",
        demo_voices={path.name: path.name for path in (root / "examples").glob("voice_*.wav")},
        voice_library_dir=root / "outputs" / "voice-library",
        progress=progress,
    )
    result = {"master": master, "package": package, "manifest": manifest, "summary": summary, "render_runtime": {"model_reused": model_reused, "resident": not cache_only, "pid": os.getpid()}}
    write_json(result_path, result)
    if request.get("fragment_only_orders"):
        reuse_message = "，已复用驻留模型" if model_reused else "，合成模型已保持驻留"
        candidate_message = "，已生成并自主验收三版候选" if request.get("advanced_segment_orders") else ""
        complete_message = f"分句 {request['fragment_only_orders'][0]} 已重新生成{candidate_message}，其他分句保持不变{reuse_message}"
    else:
        complete_message = "已使用全部已有片断串接完整音频" if cache_only else "完整音频与分轨交付已经生成"
    write_json(status_path, {"phase": "complete", "fraction": 1.0, "message": complete_message})
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--status", required=True)
    args = parser.parse_args()
    input_path = Path(args.input).resolve()
    result_path = Path(args.result).resolve()
    status_path = Path(args.status).resolve()
    request = json.loads(input_path.read_text(encoding="utf-8"))
    root = Path(request["root"]).resolve()
    if request.get("cache_only"):
        execute_render_request(request, result_path, status_path, RenderRuntime())
        return 0
    python = main_python(root)
    runtime = ensure_render_daemon(root, python)
    warm = bool(runtime.get("model_loaded"))
    write_json(status_path, {"phase": "model_ready" if warm else "runtime_ready", "fraction": 0.01, "message": "正在复用已驻留的 IndexTTS 2.5" if warm else "IndexTTS 持久运行时已就绪，正在首次加载模型"})
    request_id, _ = enqueue_render_request(Path(runtime["runtime_dir"]), input_path, result_path, status_path)
    deadline = time.monotonic() + 7200
    while True:
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            status = {}
        if status.get("phase") in {"complete", "error"}:
            if status.get("phase") == "error":
                raise RuntimeError(str(status.get("message") or "IndexTTS Render Runtime 请求失败"))
            return 0
        state = read_render_state(Path(runtime["runtime_dir"]))
        if not state or not process_alive(state.get("pid")):
            raise RuntimeError(f"IndexTTS Render Runtime 在请求 {request_id} 期间退出")
        if time.monotonic() >= deadline:
            raise TimeoutError(f"IndexTTS Render Runtime 请求 {request_id} 超过 7200 秒")
        time.sleep(0.5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        try:
            parsed = argparse.ArgumentParser(add_help=False)
            parsed.add_argument("--status")
            known, _ = parsed.parse_known_args()
            if known.status:
                write_json(Path(known.status), {"phase": "error", "fraction": 1.0, "message": str(exc)})
        except Exception:
            pass
        raise
