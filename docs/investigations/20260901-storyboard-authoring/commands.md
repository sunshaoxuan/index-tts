# 命令记录

## 自动化测试

```powershell
$env:PATH = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' test
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' build
.\.venv\Scripts\python.exe -m pytest -q --ignore=tests/test_v1.py --ignore=tests/test_v2.py
.\.venv\Scripts\python.exe -m pytest -q tests/test_text_director.py tests/test_product_analysis_worker.py tests/test_storyboard_regeneration.py
docker compose config --quiet
git diff --check
```

## 生产构建与部署

```powershell
docker compose -f compose.yaml -f .codex-task/storyboard-runtime/compose.override.yaml build --build-arg APP_REVISION=working-tree-storyboard-shots-mergefix studio
docker compose -f compose.yaml -f .codex-task/storyboard-runtime/compose.override.yaml up -d --no-build studio
docker ps --filter name=indextts25-product-studio
docker inspect indextts25-product-studio
Invoke-RestMethod http://127.0.0.1:7864/api/health
```

## Git 交付核对

```powershell
git status --short --branch
git worktree list --porcelain
git fetch fork master
git rev-parse HEAD
git rev-parse fork/master
git ls-remote fork refs/heads/master
```

## 浏览器验收

生产地址为 `http://127.0.0.1:7864/?acceptance=storyboard-mergefix`。受控临时工程 ID 为 `20260901132138-验收临时工程-分镜多镜头-9724ea`。验收完成后通过工程删除 API 精确清理。SSD 模型卷切换并重新创建生产容器后，再次只读检查 `http://127.0.0.1:7864/`，保存 `storyboard-production-7864-current.png`，没有触发分镜重建或关键帧生成。
