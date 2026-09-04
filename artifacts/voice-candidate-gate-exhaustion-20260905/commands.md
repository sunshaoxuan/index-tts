# 命令记录

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_voice_design_worker.py -q
pnpm test
pnpm run build
.\.venv\Scripts\python.exe -m pytest -m "not gpu" --basetemp=.codex-tmp\v\full -q
```

发布、运行时和 Git 远端核验命令将在执行后追加。
