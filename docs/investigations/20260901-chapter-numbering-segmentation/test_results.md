# 测试结果

| 范围 | 结果 | 备注 |
|---|---|---|
| Node 定向测试 | 50 passed | 包含 4 项章节边界单元测试和历史工程读写测试 |
| Python 文本导演定向测试 | 73 passed | 包含 AI 长章节文本覆盖和两章归属 |
| Product Studio 全量测试 | 151 passed | 0 failed |
| Python 非 GPU 全量测试 | 318 passed, 22 deselected, 30 subtests passed | 3 项依赖弃用警告 |
| Product Studio 生产构建 | passed | Vite 8.2.2，3106 modules transformed |
| 静态差异检查 | passed | 只有 Git 行尾转换提示 |
| Docker 运行验收 | passed | `indextts25-product-studio:1.1.50-02d8a7f`，running，healthy，RestartCount 0 |
| 健康接口 | passed | status ok，productVersion 1.1.5，runtime v24.10.0 |
| 白夜行01浏览器验收 | passed | 第一页 20 行章节值均为“第 1 章”，Console 0 error |
| 白夜行03浏览器验收 | passed | 第一页 20 行章节值均为“第 1 章”，Console 0 error，原长台词章节未显示 |
| 实际工程持久化复核 | passed | 133、250、154 条分句数量未改变，章节均收敛为一项 |

Node 首轮曾有 1 项回归失败，原因是保存入口误用完整工程迁移，使未知预设被降级为默认值。实现收窄为仅规范章节后，完整 Node 定向测试从起点重跑并全部通过。
