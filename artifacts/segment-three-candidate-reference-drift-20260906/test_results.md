# 测试结果

## 代码测试

| 项目 | 结果 |
|---|---|
| `tests/test_text_director.py` | 101 passed |
| `tests/test_product_render_worker.py` | 5 passed |
| Python 非 GPU 完整回归 | 368 passed，22 deselected，30 subtests passed |
| 首次 Product Studio 完整测试 | 222 passed |
| 展示排序返工后服务端聚焦测试 | 67 passed |
| 展示排序返工后 Product Studio 完整测试 | 223 passed |
| Product Studio 生产构建 | 通过，只有既有包体积提示 |

## 真实运行验收

| 项目 | 结果 |
|---|---|
| GPU 任务 | `76906b0efc8b4d5f8df22dab3ed1cf5f` complete |
| 候选相似度 | 0.862589、0.862504、0.845174 |
| 音色门槛 | 三版均为 0.82 |
| 自动门禁 | 三版 `audioQualityPassed=true`、`speakerVerified=true`、`qualityPassed=true` |
| 采用状态 | 三版 `selected=false`，`selectedCandidateId` 为空 |
| 浏览器展示 | 显示 0.863、0.863、0.845，门槛 0.820，三个“采用此版” |
| 浏览器播放 | 三个候选 `readyState=4`，播放时间均实际推进 |
| HTTP 音频 | 三个 URL 均返回 200、`audio/wav` 和正长度 |
| 浏览器 Console | error 0 条 |
| 浏览器截图 | `browser-segment-24-three-candidates.png` |
| 容器 | `indextts25-product-studio:1.1.87-7c0ac04`，running、healthy、RestartCount 0 |
| OCI revision | `7c0ac0479010cf8a0c82fd3ddd630328c8e35997` |
| GPU | NVIDIA GeForce RTX 5070 Ti |
| 健康接口 | HTTP 200，`status: ok` |
