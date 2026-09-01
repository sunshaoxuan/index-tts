# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 样本 WAV 进入模型 | `text_director.py` 的 `model.infer(spk_audio_prompt=...)`；第 165 条工程角色数据 | 高 | 未记录 GPU 内部张量转储 |
| IndexTTS 使用样本提取说话人条件 | `indextts/infer_v2_5.py` 的参考音频加载、speaker condition、参考 mel 和 CAMPPlus style | 高 | 模型本身仍允许随机候选漂移 |
| 旧质量分数不含音色 | `text_director.py` 的 `analyze_segment_candidate` | 高 | 只说明旧算法边界 |
| 最近候选存在明显音色分散 | `measure_speaker_similarity.py` 对六个真实候选的 CAMPPlus 余弦结果 | 高 | 样本量为六个候选 |
| 分句与角色节奏冲突 | 第 165 条 `segment-fragments.json` 的实际 `emotion_text` | 高 | 只复核了当前问题分句 |
| 修复覆盖人工采用保护 | `tests/test_text_director.py` 的高级重生成保留测试；`product-studio/server/index.test.mjs` 的门禁拒绝测试 | 高 | 真实浏览器和容器证据在发布阶段补充 |
