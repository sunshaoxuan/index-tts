# 验证命令

```powershell
.\.venv\Scripts\python.exe -m py_compile text_director.py product_analysis_worker.py
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_product_analysis_worker.py -q
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
pnpm test
pnpm build
git diff --check
docker compose -f compose.yaml -f .codex-task/content-type-runtime/compose.override.yaml build studio
docker compose -f compose.yaml -f .codex-task/content-type-runtime/compose.override.yaml up -d --no-build studio
```

运行态通过 `/api/projects` 建立 65 字符评论稿，调用 `/analyze`，轮询任务后读取工程 JSON，核对角色、分句、校验轮次和原文覆盖。
