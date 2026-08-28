import json

import product_render_worker as worker


def test_linux_available_memory_uses_reclaimable_memavailable():
    meminfo = (
        "MemTotal:       16372864 kB\n"
        "MemFree:          248136 kB\n"
        "MemAvailable:   11816328 kB\n"
    )

    assert worker.linux_memavailable_bytes(meminfo) == 11816328 * 1024


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


def test_render_runtime_reuses_one_loaded_model_for_later_requests(tmp_path, monkeypatch):
    loads = []

    class FakeCuda:
        @staticmethod
        def is_available():
            return False

        @staticmethod
        def is_bf16_supported():
            return False

    fake_torch = type("Torch", (), {"cuda": FakeCuda})()

    class FakeIndexTTS:
        def __init__(self, **kwargs):
            loads.append(kwargs)

    dependencies = (fake_torch, FakeIndexTTS, object(), object(), object())
    monkeypatch.setattr(worker, "prepare_render_environment", lambda root, status: dependencies)
    runtime = worker.RenderRuntime()
    first = runtime.get_model(tmp_path, tmp_path / "first-status.json")
    second = runtime.get_model(tmp_path, tmp_path / "second-status.json")

    assert len(loads) == 1
    assert first[-1] is False
    assert second[-1] is True
    assert first[-2] is second[-2]
    assert json.loads((tmp_path / "second-status.json").read_text(encoding="utf-8"))["phase"] == "model_ready"


def test_render_runtime_release_drops_model_and_cuda_cache():
    calls = []

    class FakeCuda:
        @staticmethod
        def is_available():
            return True

        @staticmethod
        def empty_cache():
            calls.append("empty_cache")

        @staticmethod
        def ipc_collect():
            calls.append("ipc_collect")

    runtime = worker.RenderRuntime()
    runtime.model = object()
    runtime.torch = type("Torch", (), {"cuda": FakeCuda})()
    assert runtime.release() is True
    assert runtime.model is None
    assert calls == ["empty_cache", "ipc_collect"]
