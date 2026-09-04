# Evidence Index

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| 旧任务长时间停在块内 | `runtime-output/product-jobs/4caad3449bee4d82b0495b7fca7d02ef/status.json` 与 `/api/jobs/...` telemetry | 高 | 旧镜像运行证据 |
| 同一模型发生两次上下文装载 | 2026-09-04 Ollama 容器日志，4096 与 8192 context，runner 启动约 237.61 秒和 206.35 秒 | 高 | 容器日志为当时运行状态 |
| 单请求占用 600 秒 | Ollama 日志 `/api/chat` 500，耗时 10m0s；任务输入 `timeout_seconds=600` | 高 | 无 |
| 700 字符级子块仍可能异常运行约 9 分钟 | Ollama 日志后续 `/api/chat` 200，耗时 9m4s；状态停留在动态拆分后的 2/4 | 高 | 无模型内部 token 轨迹 |
| 新实现预热并统一上下文 | `text_director.py` 的 `warm_model`、体裁判断与 `_chat` | 高 | 单元测试与部署运行分别验收 |
| 新实现先预拆分再逐段处理 | `text_director.py` 的 `pre_split_chunk_chars` 与逐段状态；服务端任务输入固定 700 | 高 | Product Studio 本地 Ollama 路径 |
| 新实现限制同尺寸等待与重试 | 服务端任务输入 `hot_request_timeout_seconds=120`、`chunk_validation_attempts=1` | 高 | 兼容 Provider 沿用原超时策略 |
