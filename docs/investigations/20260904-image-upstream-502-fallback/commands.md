# 命令记录

```powershell
git status --short
git diff --stat
git diff --check
node --test server/image-model-routing.test.mjs server/index.test.mjs src/api.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
docker compose config --quiet
docker compose build studio
docker compose up -d --no-build studio
docker inspect indextts25-product-studio
Invoke-WebRequest http://127.0.0.1:7864/api/health
Invoke-WebRequest https://ivs.briconbric.com/api/health
Invoke-WebRequest https://ivs.briconbric.com/
Invoke-WebRequest https://ivs.briconbric.com/api/projects/.../role-assets/role_004-1788532228895.png
node .codex-tmp/image-502-acceptance/acceptance.mjs
```

浏览器验收使用本机 Edge 的 Chrome DevTools Protocol，监听 Console、脚本异常和资源失败，等待角色图片 `complete` 且 `naturalWidth > 0` 后截图。一次性脚本和浏览器 profile 已在验收后清理。

最终 Git 验收命令将在执行后补充。
