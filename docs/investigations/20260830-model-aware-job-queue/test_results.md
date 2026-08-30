# 测试结果

| 检查 | 结果 | 证据范围 |
|---|---|---|
| 调度纯函数与服务端聚焦测试 | 通过 | 模型键、依赖阻塞、失败传播、同模型优先、既有 API 与恢复行为 |
| 持久等待任务恢复 | 通过 | 服务启动后读取 `job-queue.json` 并启动有效等待项 |
| Product Studio 全量测试 | 109 项通过 | `pnpm test` |
| Product Studio 生产构建 | 通过 | 3100 个模块，保留既有的大 chunk 警告 |
| 隔离运行页面 | 通过 | `http://127.0.0.1:7865/`，项目控制和六个工作区可见 |
| 浏览器 Console | 通过 | 最终重载后无 error 或 warning |
| 浏览器截图 | 通过 | `artifacts/model-aware-job-queue/browser-home.png` |
| 当前 7864 容器 | 通过 | 镜像 `indextts25-product-studio:1.1.34`，镜像 ID 与容器镜像 ID 均为 `sha256:04145f873ea0935a9325d21189bc87937a81cb41e6029de1ca881bc9dc5790e0` |
| 容器内源码一致性 | 通过 | 调度模块与服务入口的 SHA256 和工作树完全一致 |
| 容器运行配置 | 通过 | GPU、8 GiB 共享内存、`unless-stopped`、7864 端口、默认网络和五项现行挂载保持 |
| 容器 API 与运行时 | 通过 | 容器 healthy，RestartCount 为 0，`/api/health` 和 `/api/active-job` 正常，GPU、IndexTTS 与 VoiceDesign 环境可用 |
| 7864 浏览器页面 | 通过 | 页面完整加载现有工程，Console 无 error 或 warning |
| 7864 浏览器截图 | 通过 | `artifacts/model-aware-job-queue/container-1.1.34-browser-home.png` |
