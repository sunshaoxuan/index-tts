# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 旧实现拒绝第二个后台任务 | `product-studio/server/index.mjs` 的原 `startJob` 全局活动任务检查 | 高 | Git 工作区存在并行修改，调查基于当前 checkout 的改动前 diff |
| 模型键为稳定调度依据 | `product-studio/server/model-job-scheduler.mjs` | 高 | 全文分析配置变化会形成不同键 |
| 依赖优先且同模型任务优先 | `classifyPendingJobs` 与对应四项纯函数测试 | 高 | 真实 GPU 切换耗时未在单元测试中测量 |
| 同工程任务形成依赖 | `startJob` 建立 `dependencies`，服务端集成测试验证 | 高 | 前端一次只跟踪一个当前任务 |
| 队列可恢复 | `job-queue.json` 加载、清理和持久化路径 | 中 | 尚未完成真实进程重启压力验收 |
| 队列持久化不会暴露半写文件 | 临时文件写入与 `rename` 原子替换 | 高 | 文件系统需要支持同目录原子重命名 |
| 缺失依赖不会永久阻塞 | `missing` 依赖分类与纯函数测试 | 高 | 任务状态目录被外部删除时会进入错误终态 |
| 即时人物小传和画像不在后台队列 | `expand-profile` 与 `portrait` 路由直接调用兼容服务 | 高 | 这两个接口仍可能由并发请求形成上游竞争 |
