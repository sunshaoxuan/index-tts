# 证据索引

| 结论 | 证据 | 状态 |
|---|---|---|
| 容器未重启或 OOM | `docker inspect`：Product Studio healthy、RestartCount 0；两个容器 `OOMKilled=false` | 已验证 |
| 同一模型 runner 参数交替 | Ollama 日志：`-c 8192` 与 `-c 16384` 在任务期间交替启动 | 已验证 |
| 客户端超时中断装入 | Ollama 日志：四次 120 秒 499，伴随 `client connection closed`、`aborting load` 和 `context canceled` | 已验证 |
| 旧应用主动管理生命周期 | `text_director.py` 旧实现：空请求预热、`keep_alive=30m`、`num_ctx=8192` | 已验证 |
| 当前任务最终完成 | `/api/jobs/1f9894b7d3cd4571816227be6bdea5bd`：`phase=complete`，开始 15:53:26 UTC，状态完成 16:05:28 UTC | 已验证 |
| 具体 `16384` 调用进程 | 历史日志缺少请求体和客户端身份 | evidence_missing |
| 新请求不干预 Ollama 生命周期 | Python 请求体回归测试断言无 `keep_alive` 和 `num_ctx`；生产任务输入仅有统一 `timeout_seconds=600` | 已验证 |
| 提交后异步轮询 | Node 集成测试断言 HTTP 202、持久状态、依赖、模型优先和结果查询；浏览器提交后立即显示队列状态并持续轮询 | 已验证 |
| 生产 runner 稳定 | 真实任务 `950aad8e35d842f1b384882d0408264e` 全程使用 PID 1053、`-c 16384`；验收窗口 runner 新建 0、499 为 0、装入取消为 0 | 已验证 |
