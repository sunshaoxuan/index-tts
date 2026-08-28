# Evidence Index

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 两轮分析都使用 8B | `runtime-output/product-jobs/87c31961becf409a8d4419fe9326a857/input.json` 与 `b7101dbdcf0e4675979ef0c50292ccf0/input.json` | high | 仅对应这两轮任务 |
| 两轮都在覆盖失败后的安全兜底终止 | 两个任务的 `status.json` 与 `worker.log` | high | AI 原始响应没有单独保存 |
| 工程分句未写入 | 白夜行02 `project.json` 的 `segments` 为 0，更新时间早于两轮分析 | high | 原子写入策略下符合预期 |
| 14B 已安装且配置成功 | Ollama `/api/tags`、7864 设置测试接口与设置读取接口 | high | 当前主机运行状态 |
| 安全拆块修复覆盖真实失败文本 | 白夜行02全文强制覆盖失败模拟生成 296 条安全分句，覆盖一致 | high | 模拟 AI 全部失败路径 |
