# 测试结果

| 检查 | 结果 |
|---|---|
| Python 聚焦测试 | 80 passed |
| Python 全量测试 | 287 passed, 22 skipped, 30 subtests passed |
| Product Studio 全量测试 | 108 passed |
| Product Studio 生产构建 | PASS，3101 modules transformed |
| `git diff --check` | PASS |
| 真实 VoiceDesign 提示词对照 | 长指令失败；简洁正向模板 3 项通过，238.12、293.45、269.29 Hz |
| 正式工程真实三候选 | PASS，松浦勇 116.99、103.73、111.11 Hz；桐原亮新候选 234.36、193.53、259.04 Hz，均未预选 |
| 儿童身份分层元数据 | PASS，三项 `age_band_verified=true`、`gender_identity_verified=false`、`gender_identity_method=pending_human` |
| 桐原亮实际生成指令 | PASS，试听文本明确“我是一个10岁的男孩”，指令明确男童身份优先于音高 |
| 浏览器和 Console | PASS，真实 7864 页面显示儿童声区与男童身份分层标题，Console error 和 warn 为空 |
| 截图 | PASS，`artifacts/ivs-project-link-import/final-child-voice-gate-1.1.5.png` |
| 新候选男童听感 | 等待使用者试听确认，系统未把基频结果冒充为性别结论 |
