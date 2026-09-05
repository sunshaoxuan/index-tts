# 命令记录

## 测试与构建

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_product_render_worker.py -q
.\.venv\Scripts\python.exe -m pytest -m "not gpu" --basetemp=.codex-tmp\segment-reference-full -q
pnpm test
pnpm run build
```

## 真实任务与运行时

```powershell
Get-Content -Raw D:\workspace\IndexTTS-2.5\runtime-output\product-jobs\76906b0efc8b4d5f8df22dab3ed1cf5f\status.json
Get-Content -Raw D:\workspace\IndexTTS-2.5\runtime-output\product-jobs\76906b0efc8b4d5f8df22dab3ed1cf5f\result.json
Invoke-RestMethod -Uri http://127.0.0.1:7864/api/health
Invoke-RestMethod -Uri http://127.0.0.1:7864/api/projects/20260904043536-%E6%88%90%E9%83%BD%E7%B2%89%E5%AD%90-5b71f8/latest-render
docker inspect indextts25-product-studio
docker exec indextts25-product-studio nvidia-smi --query-gpu=name --format=csv,noheader
```

三个候选 URL 分别使用 `Invoke-WebRequest` 检查状态、Content Type 与长度。初次表格输出命令在 `foreach` 后直接接管道而触发 PowerShell 解析错误，改为先收集到数组后执行，复查结果全部通过。

## Git 交付

```powershell
git push fork master
git rev-parse HEAD
git rev-parse fork/master
git ls-remote fork refs/heads/master
```
