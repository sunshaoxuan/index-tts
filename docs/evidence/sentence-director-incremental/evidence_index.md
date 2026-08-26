# 证据索引

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| 逐句重生成只强制目标片断 | `text_director.py` 的 `force_segment_orders`、`tests/test_text_director.py`、GPU 任务 `3df53959b0a14137822361fa5feef056` | 高 | 音质的主观偏好仍由用户试听判断 |
| 串接只读取已有缓存 | `cache_only` 分支、缺失缓存单测和真实工程错误状态 | 高 | 当前工程缺少第 1 条缓存，因此没有形成新完整音频 |
| 纠音进入片断缓存与清单 | `apply_pronunciations`、manifest 字段和聚焦测试 | 高 | 实际发音听感仍需用户对生成片断试听确认 |
| 历史导演状态可重应用 | `director_memory.py`、4 个边界映射测试、analysis worker 集成 | 高 | 稿件相似度低于 0.35 时有意保留 AI 新结果 |
| 旧交付不会按序号错配 | `fragmentState.test.ts` 3 个测试和真实页面首行状态 | 高 | 匹配条件要求原文和合成文字完全一致 |
| UI 可见且控制台干净 | 7864 页面 DOM、Console 0 warning/error、`01-segment-director-fragments.png`、`03-stale-complete-delivery.jpg` | 高 | 无 |
| 编辑后受影响片断删除 | 真实页面行内音频 1 变 0、缓存文件不存在、Node 失效测试 | 高 | 删除范围为工程片断缓存 |
| 完整交付保留且标记过期 | 34,986,518 字节 WAV、三个交付 HTTP 200、`.stale.json`、过期页面截图 | 高 | 已取消删除确认，未删除任何完整交付 |
| 连续编辑不会恢复失效片断 | 累积 `invalidated_cache_keys` 测试和真实页面恢复原文后行内音频仍为 0 | 高 | 重新生成该句后可以以新草稿片断重新进入页面 |
