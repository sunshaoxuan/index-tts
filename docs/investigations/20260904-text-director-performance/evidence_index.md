# Evidence Index

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| 旧任务长时间停在块内 | `runtime-output/product-jobs/4caad3449bee4d82b0495b7fca7d02ef/status.json` 与 `/api/jobs/...` telemetry | 高 | 旧镜像运行证据 |
| 同一模型发生两次上下文装载 | 2026-09-04 Ollama 容器日志，4096 与 8192 context，runner 启动约 237.61 秒和 206.35 秒 | 高 | 容器日志为当时运行状态 |
| 单请求占用 600 秒 | Ollama 日志 `/api/chat` 500，耗时 10m0s；任务输入 `timeout_seconds=600` | 高 | 无 |
| 700 字符级子块仍可能异常运行约 9 分钟 | Ollama 日志后续 `/api/chat` 200，耗时 9m4s；状态停留在动态拆分后的 2/4 | 高 | 无模型内部 token 轨迹 |
| 新实现预热并统一上下文 | `text_director.py` 的 `warm_model`、体裁判断与 `_chat` | 高 | 单元测试与部署运行分别验收 |
| 新实现先预拆分再逐段处理 | `text_director.py` 的 `pre_split_chunk_chars` 与逐段状态；服务端任务输入固定 400 | 高 | Product Studio 本地 Ollama 路径 |
| 新实现限制同尺寸等待与重试 | 服务端任务输入 `hot_request_timeout_seconds=120`、`chunk_validation_attempts=1` | 高 | 兼容 Provider 沿用原超时策略 |
| 新任务前序分析完成后仍为空 | `/api/jobs/7266224af1914c17ad44ec93c2517a63` 返回第 2 轮 `role_002`、`role_003` 字段未落实错误；对应工程持久化结果为 0 个角色和 0 个分句 | 高 | 修复前镜像运行证据 |
| 重复未明示年龄 issue 可确定性协调 | `text_director.py` 的 `_reconcile_redundant_character_corrections` 与 `tests/test_text_director.py` 的《成都粉子》两人物回归和 explicit basis 反例 | 高 | 真实模型结果仍需部署验收 |
| 首轮修复仍慢且 role_002 失败 | 任务 `f505a93eb36241b990fa3b96fc7196ee` 共约 10 分 34 秒，正文从 3 块动态扩为 7 块，进度从 46.5% 回退到 37%，最终仍报告 `role_002` 未落实 | 高 | 第二轮修复前运行证据 |
| 人物校验与补充路由仍触发上下文切换 | 第二轮部署前 `ollama ps` 显示 `qwen3:14b` CONTEXT 为 12288；人物校验单独指定 12288；补充路由使用 4096 并主动卸载 | 高 | 最终修复统一为 8192 和 30 分钟驻留后需真实复测 |
