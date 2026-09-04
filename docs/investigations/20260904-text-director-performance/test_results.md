# Test Results

| 检查 | 结果 | 证据 |
|---|---|---|
| 文本导演聚焦测试 | PASS | 86 passed |
| Python 相关回归 | PASS | 111 passed；最终参数的文本导演聚焦测试 86 passed |
| Product Studio 完整测试 | PASS | 194 passed |
| Product Studio 生产构建 | PASS | 3109 modules transformed |
| Diff whitespace | PASS | `git diff --check` exit 0 |
| 全量非 GPU Python | 基线失败 | 335 passed，22 deselected，30 subtests passed；`tests/test_v2.py` 有 3 个 `torch.inference_mode` 测试替身导入失败，待迁移到最新 master 后重跑 |
| 真实同稿性能 | 待执行 | 等待旧镜像任务结束并部署当前提交 |
| 浏览器、Console、截图 | 待执行 | 等待部署当前提交 |

生产构建保留既有的大 chunk 告警。本次后端任务流程没有增加前端 bundle 内容。
