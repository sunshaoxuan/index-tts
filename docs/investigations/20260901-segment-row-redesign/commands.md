# 命令记录

```text
pnpm --dir product-studio test
pnpm --dir product-studio run build
docker build -f Dockerfile.app-update --build-arg BASE_IMAGE=indextts25-product-studio:1.1.45-c008883 --build-arg APP_REVISION=40a5c5faf157ba978bb4495a4f7d8f5d29dffe0e -t indextts25-product-studio:1.1.46-40a5c5f .
docker image inspect indextts25-product-studio:1.1.46-40a5c5f
docker run ... indextts25-product-studio:1.1.46-40a5c5f
Invoke-RestMethod http://127.0.0.1:7864/api/health
```

浏览器验证使用 `http://127.0.0.1:7864/?rev=40a5c5f`，检查 DOM、播放器、宽屏和窄屏尺寸、Console 与截图。
