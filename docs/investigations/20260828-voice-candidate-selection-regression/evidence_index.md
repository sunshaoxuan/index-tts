# 证据索引

| 结论 | 证据 | 状态 |
|---|---|---|
| 松浦勇误用女性声音 | `outputs/voice-library/voice-6d7e04bb41b6b289.json` 原角色为“死者妻子”，性别为 female | PASS |
| 桐原亮误用老年旁白 | `outputs/voice-library/voice-c4bf3e1793350e26.json` 原角色为旁白，年龄 55，基频 100.93 Hz | PASS |
| 儿童候选全部呈成年男声频率 | 真实候选 9 个，基频 93.98 至 106.35 Hz，任务 `8f4fb17444724ef4a015b7e2d404272c` | PASS |
| 新角色不再随机继承音色 | `product_analysis_worker.py` 与 `tests/test_product_analysis_worker.py` | PASS |
| 三候选保持待用户选择 | `product_voice_worker.py`、`voiceCandidateSelection.ts` 及对应测试 | PASS |
| 儿童身份提示不含通用男性共鸣 | `text_director.py`、`characterVoiceProfile.ts` 及对应测试 | PASS |
| 长儿童指令仍产生成人低频 | 任务 `ba49f28221a940d2b0d98fe05cbe919c`，桐原亮 9 次为 91.31 至 139.28 Hz | PASS |
| 简洁正向童声模板有效 | 同一驻留模型实验 `0fb736e17f594e478b1982cc557b3f0f`，238.12、293.45、269.29 Hz | PASS |
| 角色资产基频上下限被严格执行 | `voice_design_worker.py` 与 `tests/test_voice_design_worker.py` | PASS |
| 真实儿童声区 | 正式任务 `a020ad1c6b2d4281a287d33e3b74e63f`，桐原亮 234.36、193.53、259.04 Hz | PASS |
| 男童身份不再由基频冒充 | 三项候选均登记 `gender_identity_method=pending_human`，页面显示“男童身份待试听确认” | PASS |
| 多语言身份锚定试听文本 | 三项永久音色元数据均记录“我是一个10岁的男孩，刚从学校回来” | PASS |
| 浏览器、Console、截图 | 7864 角色资产页，Console error 和 warn 为空，`artifacts/ivs-project-link-import/final-child-voice-gate-1.1.5.png` | PASS |
| 新候选男童听感 | 使用者试听后通过“确认男童并采用”记录 | WAITING USER |
