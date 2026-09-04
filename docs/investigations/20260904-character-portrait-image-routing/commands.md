# 命令记录

以下命令在本次调查中执行，密钥内容未写入证据。

```powershell
docker compose ps studio
docker inspect indextts25-product-studio --format '{{.Config.Image}}|{{.State.Status}}|{{.State.Health.Status}}|{{.RestartCount}}|{{index .Config.Labels "org.opencontainers.image.revision"}}'
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7864/api/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7864/
docker exec indextts25-product-studio sh -lc "grep -n 'chat/completions\|responseModalities' /app/product-studio/server/image-model-routing.mjs /app/product-studio/server/index.mjs"
Invoke-WebRequest -Method Post http://127.0.0.1:7864/api/projects/20260904043536-成都粉子-5b71f8/roles/narrator/portrait
Invoke-WebRequest -Method Put http://127.0.0.1:7864/api/settings/ai-media
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7864/api/projects/20260904043536-成都粉子-5b71f8/role-assets/narrator-1788529104302.png
docker logs --since 10m indextts25-product-studio
git diff --check
```

浏览器验收通过 Product Studio 页面执行：进入角色资产，打开旁白角色卡片，点击生成，应用角色设置，保存当前工程，检查角色卡片图片与 Console。
