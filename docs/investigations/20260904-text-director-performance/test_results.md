# Test Results

| 检查 | 结果 | 证据 |
|---|---|---|
| 文本导演聚焦测试 | PASS | 95 passed；包含《成都粉子》真实 issue、编号紧凑协议、冻结人物表与失败人物小批次隔离重做 |
| Python 相关回归 | PASS | 122 passed |
| Product Studio 完整测试 | PASS | 215 passed |
| Product Studio 生产构建 | PASS | 3110 modules transformed |
| Diff whitespace | PASS | `git diff --check` exit 0 |
| 全量非 GPU Python | PASS | 355 passed，22 deselected，30 subtests passed |
| 真实同稿性能 | PASS | 82.967 秒墙钟；17196 输入、5718 输出；6 块、0 fallback、5 角色、5 场景、69 分句、覆盖 100% |
| 浏览器、Console、截图 | 待执行 | 等待部署当前提交 |

生产构建保留既有的大 chunk 告警。本次后端任务流程没有增加前端 bundle 内容。
