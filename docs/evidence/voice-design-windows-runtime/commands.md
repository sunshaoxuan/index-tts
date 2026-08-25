# 验证命令

```powershell
.\.venv\Scripts\python.exe -m py_compile voice_design_daemon_client.py voice_design_daemon.py product_voice_worker.py
.\.venv\Scripts\python.exe -m pytest tests\test_voice_design_daemon.py tests\test_voice_design_worker.py -q
Push-Location product-studio
node.exe --test server\index.test.mjs
Pop-Location
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
```

运行态通过 `POST /api/projects/20260825-104455-白夜行01-869866/voices` 提交，并轮询 `GET /api/jobs/df4e88f2bfa44f09a47d2402f1f9ebf6` 至 complete。
