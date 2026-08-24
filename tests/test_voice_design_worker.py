import json
import sys
import types

import numpy as np

import voice_design_worker as worker


def test_voice_design_worker_generates_each_role(tmp_path, monkeypatch):
    class FakeModel:
        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        def generate_voice_design(self, **kwargs):
            return [np.zeros(2400, dtype=np.float32)], 24000

    fake_qwen = types.ModuleType("qwen_tts")
    fake_qwen.Qwen3TTSModel = FakeModel
    monkeypatch.setitem(sys.modules, "qwen_tts", fake_qwen)
    input_path = tmp_path / "input.json"
    result_path = tmp_path / "result.json"
    status_path = tmp_path / "status.json"
    output_dir = tmp_path / "voices"
    input_path.write_text(json.dumps({"jobs": [{"role_id": "narrator", "name": "旁白", "filename": "narrator.wav", "text": "测试", "language": "Chinese", "instruct": "稳定"}], "output_dir": str(output_dir), "model_dir": str(tmp_path / "model")}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["worker", "--input", str(input_path), "--result", str(result_path), "--status", str(status_path)])

    assert worker.main() == 0
    result = json.loads(result_path.read_text(encoding="utf-8"))
    assert result["generated"][0]["role_id"] == "narrator"
    assert (output_dir / "narrator.wav").is_file()
    assert json.loads(status_path.read_text(encoding="utf-8"))["phase"] == "complete"
