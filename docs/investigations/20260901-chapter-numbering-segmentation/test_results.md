# 测试结果

| 范围 | 结果 | 备注 |
|---|---|---|
| Node 定向测试 | 50 passed | 包含 4 项章节边界单元测试和历史工程读写测试 |
| Python 文本导演定向测试 | 73 passed | 包含 AI 长章节文本覆盖和两章归属 |
| Product Studio 全量测试 | 151 passed | 0 failed |
| Python 非 GPU 全量测试 | 318 passed, 22 deselected, 30 subtests passed | 3 项依赖弃用警告 |
| Product Studio 生产构建 | passed | Vite 8.2.2，3106 modules transformed |
| 静态差异检查 | passed | 只有 Git 行尾转换提示 |

Node 首轮曾有 1 项回归失败，原因是保存入口误用完整工程迁移，使未知预设被降级为默认值。实现收窄为仅规范章节后，完整 Node 定向测试从起点重跑并全部通过。
