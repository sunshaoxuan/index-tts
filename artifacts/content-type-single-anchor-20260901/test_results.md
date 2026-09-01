# 测试结果

| 验证 | 结果 |
| --- | --- |
| Python 语法检查 | 通过 |
| 体裁导演与 Worker 聚焦测试 | 93 passed |
| Product Studio 测试 | 160 passed |
| Product Studio 生产构建 | 通过，3108 modules transformed |
| 生产构建提示 | 单个 bundle 超过 1100 kB，属于现有性能提示 |
| Docker 健康检查 | healthy，`/api/health` status=ok |
| 真实 Qwen 14B 评论分析 | 通过，1 主播、3 分句、0 人物校验轮次、100% 原文覆盖 |
| 浏览器页面与 Console | 通过，0 warning、0 error |

全量非 GPU Python 回归为 326 passed、3 failed、22 deselected、30 subtests passed。3 个失败均位于 `tests/test_v2.py` 的 `indextts.infer_v2_5` 参数组，测试替身缺少 `torch.inference_mode`，与本次体裁路由文件无关。体裁导演、Worker 与并行分镜聚焦测试为 96 passed。
