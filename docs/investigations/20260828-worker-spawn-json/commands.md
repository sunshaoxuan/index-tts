# 命令记录

```powershell
docker compose ps
docker logs --since 30m indextts25-product-studio
docker exec indextts25-product-studio sh -lc '/app/.venv/bin/python -c "import sys, indextts; print(sys.prefix, indextts.__file__)"'
docker exec indextts25-product-studio sh -lc '/opt/voice-venv/bin/python -c "import sys, importlib.util; print(sys.prefix, importlib.util.find_spec(\"qwen_tts\").origin)"'
pnpm --dir product-studio test
pnpm --dir product-studio build
.\.venv\Scripts\python.exe -m pytest tests/test_runtime_python.py
docker compose config --quiet
git diff --check
```

浏览器验收通过页面按钮发起角色音色任务，检查进度浮层、完成终态、Console 和截图。
