# 测试结果

| 检查 | 结果 | 证据范围 |
|---|---|---|
| 调度纯函数与服务端聚焦测试 | 通过 | 模型键、依赖阻塞、失败传播、同模型优先、既有 API 与恢复行为 |
| 持久等待任务恢复 | 通过 | 服务启动后读取 `job-queue.json` 并启动有效等待项 |
| Product Studio 全量测试 | 122 项通过 | 在整合后的本机 `master` 执行 `pnpm test` |
| Product Studio 生产构建 | 通过 | 3103 个模块，保留既有的大 chunk 警告 |
| 隔离运行页面 | 通过 | `http://127.0.0.1:7865/`，项目控制和六个工作区可见 |
| 浏览器 Console | 通过 | 最终重载后无 error 或 warning |
| 浏览器截图 | 通过 | `artifacts/model-aware-job-queue/browser-home.png` |
| 当前 7864 容器 | 通过 | 镜像 `indextts25-product-studio:1.1.36`，revision 对应最终 `master` |
| 容器内源码一致性 | 通过 | 调度模块、服务入口及两项相关测试的 SHA256 和最终 `master` 工作树完全一致 |
| 容器运行配置 | 通过 | GPU、8 GiB 共享内存、`unless-stopped`、7864 端口、默认网络和五项现行挂载保持 |
| 容器 API 与运行时 | 通过 | 容器 healthy，RestartCount 为 0，`/api/health` 和 `/api/active-job` 正常，GPU、IndexTTS 与 VoiceDesign 环境可用 |
| 7864 浏览器页面 | 通过 | 页面完整加载现有工程，Console 无 error 或 warning |
| 7864 浏览器截图 | 通过 | `artifacts/model-aware-job-queue/container-1.1.36-master-browser-home.png` |
| Git `master` 交付 | 通过 | `sunshaoxuan/index-tts` fork，本机 `master`、`fork/master` 和 GitHub 实际 ref 一致 |
