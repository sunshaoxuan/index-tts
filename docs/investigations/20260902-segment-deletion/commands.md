# 命令记录

## 仓库与证据

```powershell
git status --short --branch
rg -n "segments/:|regenerate|assemble|分句" product-studio/src product-studio/server
git diff --check
```

## 测试与构建

```powershell
node --test src/segmentState.test.ts src/segmentRowLayout.test.ts server/index.test.mjs
$env:PATH='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:PATH
pnpm test
pnpm build
```

## 运行验收

```powershell
$env:HOST='127.0.0.1'
$env:PORT='7865'
node server/index.mjs
Invoke-RestMethod http://127.0.0.1:7865/api/projects/...
Invoke-RestMethod http://127.0.0.1:7864/api/health
docker ps --filter name=indextts25-product-studio
```

浏览器使用当前构建打开 `http://127.0.0.1:7865/`，检查桌面与 390×844 视口、确认层、刷新后分句、原稿保留、控制台和截图。

## 正式环境上线

```powershell
docker compose config
docker compose build studio
docker image inspect indextts25-product-studio:1.1.65-1f8b411
Invoke-RestMethod http://127.0.0.1:7864/api/active-job
docker compose up -d --no-build --force-recreate studio
docker inspect indextts25-product-studio
Invoke-RestMethod http://127.0.0.1:7864/api/health
```

正式浏览器打开 `http://127.0.0.1:7864/`，验证桌面与 390×844 视口、选择后按钮启用、确认层、取消恢复、Console 和截图。最终删除按钮未点击，用户现有工程数据保持不变。
