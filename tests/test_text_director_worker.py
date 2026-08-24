import json
import sys
from pathlib import Path

import text_director_worker as worker


def test_text_director_worker_writes_status_and_result(tmp_path, monkeypatch):
    class FakeDirector:
        def __init__(self, config):
            self.config = config

        def health_summary(self):
            return "ready"

        def analyze_document(self, source_text, content_type, guidance, progress):
            progress(0.5, desc="正在处理测试文本")
            return {"title": "测试", "segments": [{"text": source_text}]}

    input_path = tmp_path / "input.json"
    result_path = tmp_path / "result.json"
    status_path = tmp_path / "status.json"
    input_path.write_text(json.dumps({"config": {}, "source_text": "你好", "content_type": "story", "guidance": ""}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(worker, "OllamaTextDirector", FakeDirector)
    monkeypatch.setattr(sys, "argv", ["worker", "--input", str(input_path), "--result", str(result_path), "--status", str(status_path)])

    assert worker.main() == 0
    assert json.loads(result_path.read_text(encoding="utf-8"))["title"] == "测试"
    assert json.loads(status_path.read_text(encoding="utf-8"))["phase"] == "complete"
