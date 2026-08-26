from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from novel_project import NovelProjectStore, pronunciation_rows
from text_director import DirectorConfig, OllamaTextDirector, apply_generated_voices, build_voice_design_jobs, guidance_role_signature
from voice_design_daemon_client import enqueue_voice_design_request, ensure_voice_design_daemon, process_alive, read_runtime_state
from render_daemon_client import release_render_model


def write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def _legacy_effective_guidance(instruct: str) -> str:
    marker = "本角色有效导演上下文："
    boundary = "。人物小传："
    if marker not in instruct or boundary not in instruct:
        return ""
    return instruct.split(marker, 1)[1].split(boundary, 1)[0].strip()


def quarantine_cross_role_voices(store: NovelProjectStore, routing: dict[str, Any], active_voice_ids: set[str] | None = None) -> set[str]:
    assignments = routing.get("assignments") if isinstance(routing, dict) else []
    quarantined: set[str] = set()
    for metadata_path in store.voice_library_root.glob("voice-*.json"):
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            voice_id = str(metadata.get("voice_id") or metadata_path.stem)
            if active_voice_ids is not None and voice_id not in active_voice_ids:
                continue
            role_id = str(metadata.get("role_id") or "")
            instruct = str(metadata.get("instruct") or "")
            structured_sources = {str(value).strip() for value in metadata.get("effective_guidance_sources", []) if str(value).strip()}
            structured_instructions = {str(value).strip() for value in metadata.get("effective_guidance_instructions", []) if str(value).strip()}
            legacy_context = _legacy_effective_guidance(instruct) if not structured_sources and not structured_instructions else ""
            forbidden = [
                (str(item.get("source_text") or "").strip(), str(item.get("instruction") or "").strip())
                for item in assignments or []
                if isinstance(item, dict) and role_id not in item.get("target_role_ids", [])
            ]
            matched = [
                source or instruction
                for source, instruction in forbidden
                if (source and source in structured_sources)
                or (instruction and instruction in structured_instructions)
                or (legacy_context and ((source and source in legacy_context) or (instruction and instruction in legacy_context)))
            ]
            if not matched:
                continue
            metadata["quarantined"] = True
            metadata["quarantine_reason"] = f"包含分配给其他轨道的导演补充：{'；'.join(matched)}"
            metadata["quarantined_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            write_json(metadata_path, metadata)
            quarantined.add(voice_id)
        except (OSError, ValueError, TypeError):
            continue
    return quarantined


def resolve_or_reuse_guidance(project: dict[str, Any], director: OllamaTextDirector) -> tuple[dict[str, Any], bool]:
    guidance = str(project.get("guidance") or "").strip()
    document = project.get("document") if isinstance(project.get("document"), dict) else {}
    existing = document.get("guidance_routing") if isinstance(document, dict) else None
    expected_signature = guidance_role_signature(project.get("roles") or [])
    if (
        isinstance(existing, dict)
        and str(existing.get("guidance") or "").strip() == guidance
        and str(existing.get("model") or "") == director.config.model
        and str(existing.get("role_signature") or "") == expected_signature
        and isinstance(existing.get("assignments"), list)
    ):
        return existing, True
    return director.resolve_guidance(guidance, project.get("roles") or []), False


def prepare_voice_runtime(root: Path, voice_python: Path) -> dict[str, Any]:
    release_render_model(root)
    return ensure_voice_design_daemon(root, voice_python)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--status", required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.input).read_text(encoding="utf-8"))
    root = Path(request["root"]).resolve()
    status = Path(args.status).resolve()
    store = NovelProjectStore(root / "outputs" / "novel-projects", root / "outputs" / "voice-library")
    project = store.load(request["project_id"])
    director = OllamaTextDirector(DirectorConfig())
    document = dict(project["document"])
    cached_routing = resolve_or_reuse_guidance(project, director)
    document["guidance_routing"], routing_reused = cached_routing
    routing_message = "正在复用已有导演补充分配" if routing_reused else "正在用 AI 分配导演补充的角色影响范围"
    write_json(status, {"phase": "routing_guidance", "fraction": 0.01, "message": routing_message})
    active_voice_ids = {str(row[5]).strip() for row in project["roles"] if len(row) > 5 and str(row[5]).strip()}
    quarantined = quarantine_cross_role_voices(store, document["guidance_routing"], active_voice_ids)
    roles = [list(row) for row in project["roles"]]
    for row in roles:
        if str(row[5]) in quarantined:
            row[7] = "是"
    project = store.save(
        project["project_id"], title=project["title"], content_type=project["content_type"], source_text=project["source_text"],
        guidance=project.get("guidance", ""), document=document, roles=roles, segments=project["segments"],
        pronunciations=pronunciation_rows(project.get("pronunciations")), voice_files=project.get("voice_files") or [],
    )
    jobs = build_voice_design_jobs(project["document"], project["roles"], project)
    output_dir = store.project_dir(project["project_id"]) / "voices"
    model_dir = root / "checkpoints" / "Qwen3-TTS-12Hz-1.7B-VoiceDesign"
    voice_python = root / ".venv-voice-design" / "Scripts" / "python.exe"
    jobs_by_role = {job["role_id"]: job for job in jobs}
    rows_by_role = {str(row[0]): row for row in project["roles"]}
    registered, pending, preserved_count = [], [], 0
    for job in jobs:
        row = rows_by_role[job["role_id"]]
        if str(row[7]) == "否" and str(row[5]).strip():
            preserved_count += 1
            continue
        cached = store.find_voice(job, model=str(model_dir), seed=42)
        if cached:
            registered.append({"role_id": job["role_id"], "name": job["name"], "path": cached["audio_path"], "voice_id": cached["voice_id"]})
        else:
            pending.append(job)
    generated = []
    voice_runtime: dict[str, Any] | None = None
    voice_result: dict[str, Any] = {}
    if pending:
        voice_runtime = prepare_voice_runtime(root, voice_python)
        runtime_dir = Path(voice_runtime["runtime_dir"])
        warm = bool(voice_runtime.get("model_loaded"))
        runtime_message = "正在复用已驻留的 VoiceDesign 模型" if warm else "VoiceDesign 常驻进程已就绪，正在首次加载模型"
        write_json(status, {"phase": "loading", "fraction": 0.02, "message": f"{runtime_message}，共 {len(pending)} 个待生成音色"})
        with tempfile.TemporaryDirectory(dir=store.project_dir(project["project_id"]) / "process") as temporary:
            temp = Path(temporary)
            worker_input, worker_result, worker_status = temp / "input.json", temp / "result.json", temp / "status.json"
            write_json(worker_input, {"jobs": pending, "output_dir": str(output_dir), "model_dir": str(model_dir), "seed": 42})
            request_id, _ = enqueue_voice_design_request(runtime_dir, worker_input, worker_result, worker_status)
            last_inner = None
            deadline = time.monotonic() + 3600
            inner: dict[str, Any] = {}
            while True:
                if worker_status.is_file():
                    try:
                        inner = json.loads(worker_status.read_text(encoding="utf-8"))
                        signature = (inner.get("phase"), inner.get("fraction"), inner.get("message"))
                        if signature != last_inner:
                            fraction = min(0.95, 0.03 + 0.92 * float(inner.get("fraction", 0)))
                            write_json(status, {"phase": "voice_design", "fraction": fraction, "message": str(inner.get("message") or "正在生成角色音色")})
                            last_inner = signature
                        if inner.get("phase") in {"complete", "error"}:
                            break
                    except (OSError, ValueError, TypeError):
                        pass
                current_runtime = read_runtime_state(runtime_dir)
                if not current_runtime or not process_alive(current_runtime.get("pid")):
                    raise RuntimeError(f"VoiceDesign Runtime 在请求 {request_id} 期间退出")
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"VoiceDesign Runtime 请求 {request_id} 超过 3600 秒")
                time.sleep(0.5)
            if inner.get("phase") == "error":
                raise RuntimeError(str(inner.get("message") or "VoiceDesign Runtime 生成失败"))
            voice_result = json.loads(worker_result.read_text(encoding="utf-8"))
            generated = voice_result["generated"]
            write_json(status, {"phase": "registering", "fraction": 0.97, "message": "正在注册永久音色并更新工程"})
    for item in generated:
        job = jobs_by_role[item["role_id"]]
        verified_job = {
            **job,
            "median_pitch_hz": item.get("median_pitch_hz"),
            "generation_attempts": item.get("generation_attempts"),
            "candidate_metrics": item.get("candidate_metrics"),
            "gender_verified": str(item.get("expected_gender")) not in {"female", "male"} or item.get("median_pitch_hz") is not None,
        }
        metadata = store.register_voice(item["path"], verified_job, model=str(model_dir), seed=42)
        registered.append({"role_id": item["role_id"], "name": item["name"], "path": metadata["audio_path"], "voice_id": metadata["voice_id"], "expected_gender": metadata["expected_gender"], "median_pitch_hz": metadata["median_pitch_hz"]})
    roles = apply_generated_voices(project["roles"], registered)
    store.save(
        project["project_id"], title=project["title"], content_type=project["content_type"], source_text=project["source_text"],
        guidance=project.get("guidance", ""), document=project["document"], roles=roles, segments=project["segments"],
        pronunciations=pronunciation_rows(project.get("pronunciations")),
        voice_files=list(dict.fromkeys([*(project.get("voice_files") or []), *[item["path"] for item in registered]])),
    )
    runtime_summary = "已复用驻留模型" if voice_result.get("model_reused") else "模型已保持驻留" if generated else "未调用模型"
    write_json(Path(args.result), {"roles": roles, "voices": registered, "voice_runtime": {"pid": voice_result.get("runtime_pid") or (voice_runtime or {}).get("pid"), "model_reused": voice_result.get("model_reused"), "resident": bool(generated)}})
    write_json(status, {"phase": "complete", "fraction": 1.0, "message": f"角色音色设计完成，新生成 {len(generated)} 个，签名复用 {len(registered) - len(generated)} 个，保留已有 {preserved_count} 个；{runtime_summary}"})
    return 0


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
