# 命令记录

1. `docker logs --since 2h indextts25-product-studio`
2. 测量 `outputs/novel-projects/*/project.json` 和主要字段的 UTF-8 JSON 字节数。
3. 使用工作区 Node 运行 `node --test src/api.test.ts server/index.test.mjs`。
4. 在 `product-studio` 运行 `pnpm test` 和 `pnpm build`。
5. 使用 `Dockerfile.app-update` 构建 `indextts25-product-studio:1.1.47-b4c1cf5`。
6. 替换 studio 容器并检查 `/api/health`、镜像 revision、挂载和 RestartCount。
7. 在真实白夜行02工程中观察 PUT、分句 59 POST、任务终态、片断 URL、浏览器音频状态和控制台。
8. 比较宿主与容器的 `api.ts`、`index.mjs` SHA256。
