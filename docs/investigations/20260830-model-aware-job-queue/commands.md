# 命令记录

1. `git status --short --branch`
2. `rg` 检索任务、队列、模型、依赖和生成入口
3. `D:\nginx\runtime\node\node.exe --test server/model-job-scheduler.test.mjs server/index.test.mjs`
4. `D:\nginx\runtime\node\pnpm.cmd test`
5. `D:\nginx\runtime\node\pnpm.cmd build`
6. 隔离服务运行于 `http://127.0.0.1:7865/`，使用应用内浏览器检查 DOM、Console 和截图
7. `docker ps`、`docker image inspect` 与容器内源码检查
8. `git ls-remote --heads origin master main`

首轮聚焦测试为 43 项通过、1 项失败。失败原因是等待状态说明未在活动任务存在时刷新。修正后从起点重跑，44 项全部通过。

新增持久等待任务恢复、原子队列写入和缺失依赖终止逻辑后，从全量流程起点重跑。Product Studio 109 项测试全部通过，生产构建成功。隔离页面显示项目控制和六个工作区，Console 无错误，截图保存为 `artifacts/model-aware-job-queue/browser-home.png`。

## 现行容器部署

1. 调用 `/api/active-job` 并检查 `runtime-output/product-jobs/job-queue.json`，确认没有活动生成或等待队列。
2. 使用 `docker inspect` 记录现行镜像、GPU、网络、重启策略、共享内存、端口和挂载。
3. 使用 `Dockerfile.app-update`，以 `indextts25-product-studio:1.1.33` 为基础构建 `indextts25-product-studio:1.1.34`。
4. 镜像 revision 为 `working-tree-78c006f-model-queue-20260830`，镜像 ID 为 `sha256:04145f873ea0935a9325d21189bc87937a81cb41e6029de1ca881bc9dc5790e0`。
5. 在替换前再次确认 `/api/active-job` 为空闲，然后通过临时 Compose override 重新创建 `indextts25-product-studio`。
6. 容器 healthy，RestartCount 为 0，容器镜像 ID 与目标镜像一致。
7. 容器内 `model-job-scheduler.mjs` SHA256 为 `aa3601ed28a2ee486846a46c168c36b56c7dec15613cd93aa76f825b8b57e6ca`，`index.mjs` SHA256 为 `806a08e8e4a84ccce4f074208d268100301b11636f16496fbea9063d71682b37`，两者与工作树一致。
8. `/api/health`、`/api/active-job`、GPU、IndexTTS 环境和 VoiceDesign 环境通过。
9. 应用内浏览器检查 `http://127.0.0.1:7864/`，DOM 完整加载现有工程，Console 无 error 或 warning。
10. 浏览器截图保存为 `artifacts/model-aware-job-queue/container-1.1.34-browser-home.png`。
