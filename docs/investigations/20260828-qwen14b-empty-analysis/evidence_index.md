# Evidence Index

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 两轮分析都使用 8B | `runtime-output/product-jobs/87c31961becf409a8d4419fe9326a857/input.json` 与 `b7101dbdcf0e4675979ef0c50292ccf0/input.json` | high | 仅对应这两轮任务 |
| 两轮都在覆盖失败后的安全兜底终止 | 两个任务的 `status.json` 与 `worker.log` | high | AI 原始响应没有单独保存 |
| 工程分句未写入 | 白夜行02 `project.json` 的 `segments` 为 0，更新时间早于两轮分析 | high | 原子写入策略下符合预期 |
| 14B 已安装且配置成功 | Ollama `/api/tags`、7864 设置测试接口与设置读取接口 | high | 当前主机运行状态 |
| 安全拆块修复覆盖真实失败文本 | 白夜行02全文强制覆盖失败模拟生成 296 条安全分句，覆盖一致 | high | 模拟 AI 全部失败路径 |
| 真实 14B 路由与全文块执行成立 | `09838d0fc3ed404e93e392817d9cb4fe/input.json`、状态历史、Ollama `/api/ps` | high | 任务在后处理阶段终止 |
| 干净镜像后处理失败来自空示例音色表 | `09838d0fc3ed404e93e392817d9cb4fe/worker.log` 与 `product_analysis_worker.py` | high | 原始 AI 文档未在失败前落盘 |
| 工程存在可用正式音色 | 白夜行02项目 API 返回 22 个 `voice_files` | high | 失败时 `segments` 仍为 0 |
| 关联角色资产按并集合并 | `merge_analysis_roles` 回归测试覆盖重叠复用、新增 ID 冲突、未出现角色保留和分句 ID 改写 | high | 仍需真实 14B 运行验收 |
| 两个验收临时工程已清理 | 两次项目 DELETE API 成功，复查匹配数为 0 | high | API 删除无应用内回收站 |
