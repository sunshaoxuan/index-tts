# 命令记录

```powershell
node --check product-studio/server/index.mjs
node --test product-studio/server/*.test.mjs product-studio/src/*.test.ts
node product-studio/node_modules/typescript/bin/tsc -b
node product-studio/node_modules/vite/bin/vite.js build
docker compose config --quiet
docker compose build studio
docker compose up -d studio
docker exec indextts25-product-studio node --test product-studio/server/image-model-routing.test.mjs
Invoke-RestMethod http://127.0.0.1:7864/api/health
Invoke-RestMethod http://127.0.0.1:7864/api/settings/ai-media
git diff --check
```

最终复验使用 `D:\nginx\runtime\node\node.exe` 作为明确的 Node 24 运行时。第一次通过当前 `pnpm` 包装器启动时，系统 `PATH` 未包含 Node，测试在发现测试文件前退出；补入上述运行时路径后，全量测试正常执行并通过。

浏览器验收使用应用内浏览器访问 `http://127.0.0.1:7864/`，覆盖桌面与 390 x 844 视口、设置弹窗、分镜模型控件、Console 和截图。
