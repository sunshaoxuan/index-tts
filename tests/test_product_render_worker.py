import json

import product_render_worker as worker


def test_render_preparation_releases_voice_model_before_import(tmp_path, monkeypatch):
    status_path = tmp_path / "status.json"
    calls = []
    dependencies = (object(), object(), object(), object(), object())

    monkeypatch.setattr(worker, "release_voice_design_model", lambda root: calls.append(("release", root)))
    monkeypatch.setattr(worker, "available_memory_bytes", lambda: 8 * 1024**3)
    monkeypatch.setattr(worker, "_load_render_dependencies", lambda: calls.append(("import", None)) or dependencies)

    result = worker.prepare_render_environment(tmp_path, status_path)

    assert result == dependencies
    assert calls == [("release", tmp_path), ("import", None)]
    assert json.loads(status_path.read_text(encoding="utf-8")) == {
        "phase": "importing",
        "fraction": 0.01,
        "message": "正在加载 PyTorch CUDA 运行库",
    }


def test_render_preparation_fails_fast_when_memory_is_still_exhausted(tmp_path, monkeypatch):
    status_path = tmp_path / "status.json"
    monkeypatch.setattr(worker, "release_voice_design_model", lambda root: {"runtime_available": True, "released": True})
    monkeypatch.setattr(worker, "available_memory_bytes", lambda: 512 * 1024**2)
    monkeypatch.setattr(worker, "_load_render_dependencies", lambda: (_ for _ in ()).throw(AssertionError("must not import")))

    try:
        worker.prepare_render_environment(tmp_path, status_path)
    except RuntimeError as error:
        assert "可用内存不足" in str(error)
        assert "0.5 GiB" in str(error)
    else:
        raise AssertionError("memory exhaustion was accepted")

    assert json.loads(status_path.read_text(encoding="utf-8"))["phase"] == "preparing"
