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
