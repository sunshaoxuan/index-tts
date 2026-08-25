from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from novel_project import NovelProjectStore, pronunciation_rows
from text_director import DirectorConfig, OllamaTextDirector, apply_generated_voices, build_voice_design_jobs


def write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def quarantine_cross_role_voices(store: NovelProjectStore, routing: dict[str, Any]) -> set[str]:
    assignments = routing.get("assignments") if isinstance(routing, dict) else []
    quarantined: set[str] = set()
    for metadata_path in store.voice_library_root.glob("voice-*.json"):
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            role_id = str(metadata.get("role_id") or "")
            instruct = str(metadata.get("instruct") or "")
            forbidden = [
                str(item.get("source_text") or "").strip()
                for item in assignments or []
                if isinstance(item, dict) and role_id not in item.get("target_role_ids", [])
            ]
            matched = [fragment for fragment in forbidden if fragment and fragment in instruct]
            if not matched:
                continue
            metadata["quarantined"] = True
            metadata["quarantine_reason"] = f"包含分配给其他轨道的导演补充：{'；'.join(matched)}"
            metadata["quarantined_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            write_json(metadata_path, metadata)
            quarantined.add(str(metadata.get("voice_id") or metadata_path.stem))
        except (OSError, ValueError, TypeError):
            continue
    return quarantined


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
    write_json(status, {"phase": "routing_guidance", "fraction": 0.01, "message": "正在用 AI 分配导演补充的角色影响范围"})
    director = OllamaTextDirector(DirectorConfig())
    document = dict(project["document"])
    document["guidance_routing"] = director.resolve_guidance(project.get("guidance", ""), project["roles"])
    quarantined = quarantine_cross_role_voices(store, document["guidance_routing"])
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
    if pending:
        write_json(status, {"phase": "loading", "fraction": 0.02, "message": f"正在启动 VoiceDesign，共 {len(pending)} 个待生成音色"})
        with tempfile.TemporaryDirectory(dir=store.project_dir(project["project_id"]) / "process") as temporary:
            temp = Path(temporary)
            worker_input, worker_result, worker_status = temp / "input.json", temp / "result.json", temp / "status.json"
            write_json(worker_input, {"jobs": pending, "output_dir": str(output_dir), "model_dir": str(model_dir), "seed": 42})
            completed = subprocess.Popen(
                [str(voice_python), str(root / "voice_design_worker.py"), "--input", str(worker_input), "--result", str(worker_result), "--status", str(worker_status)],
                cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", errors="replace",
            )
            last_inner = None
            while completed.poll() is None:
                if worker_status.is_file():
                    try:
                        inner = json.loads(worker_status.read_text(encoding="utf-8"))
                        signature = (inner.get("phase"), inner.get("fraction"), inner.get("message"))
                        if signature != last_inner:
                            fraction = min(0.95, 0.03 + 0.92 * float(inner.get("fraction", 0)))
                            write_json(status, {"phase": "voice_design", "fraction": fraction, "message": str(inner.get("message") or "正在生成角色音色")})
                            last_inner = signature
                    except (OSError, ValueError, TypeError):
                        pass
                time.sleep(0.5)
            stdout, stderr = completed.communicate()
            if completed.returncode:
                detail = json.loads(worker_status.read_text(encoding="utf-8")).get("message", stderr[-1000:])
                raise RuntimeError(detail)
            generated = json.loads(worker_result.read_text(encoding="utf-8"))["generated"]
            write_json(status, {"phase": "registering", "fraction": 0.97, "message": "正在注册永久音色并更新工程"})
    for item in generated:
        job = jobs_by_role[item["role_id"]]
        verified_job = {
            **job,
            "median_pitch_hz": item.get("median_pitch_hz"),
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
    write_json(Path(args.result), {"roles": roles, "voices": registered})
    write_json(status, {"phase": "complete", "fraction": 1.0, "message": f"角色音色设计完成，新生成 {len(generated)} 个，签名复用 {len(registered) - len(generated)} 个，保留已有 {preserved_count} 个"})
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
