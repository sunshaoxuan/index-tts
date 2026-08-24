# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| AI 分析支持小说、新闻、故事和自动识别 | `text_director.py` 的 `CONTENT_TYPES` 与导演提示词 | 高 | 浏览器样本使用小说 |
| 原文覆盖校验和引号恢复有效 | `tests/test_text_director.py`，真实页面显示原文覆盖 100% | 高 | 实质改写仍会拒绝 |
| 旁白、人物和孩子可独立分轨 | `01-ai-analysis.png`，最终 JSON 和 CSV | 高 | 未命名说话者依赖可识别归属文字 |
| 宽表可读且支持横向滚动 | `03-ui-feedback-and-tables.png`，DOM 测量为 1180 px 和 1660 px，`overflow-x:auto` | 高 | 当前验收视口约 1265 px |
| 长任务有阶段反馈和真实取消 | `06-safe-render-cancel.png`，浏览器即时状态与后台进程检查 | 高 | 完整音频在当前分句结束后停止 |
| 系统可生成合适角色音色 | `04-ai-role-voices.png`，Qwen3-TTS VoiceDesign 生成 4 条角色参考音频 | 高 | 冷启动和模型恢复耗时较长 |
| IndexTTS 生成完整音频和角色轨道 | `05-complete-audio-delivery.png`，`outputs/director/20260824-195528-雨夜的旧书店` | 高 | 当前为短篇真实样本 |
| ZIP 内容完整 | Python `ZipFile.testzip()` 返回空值，ZIP 包含 14 个交付条目 | 高 | 无 |
| 浏览器控制台正常 | 最终 `tab.dev.logs` 返回空列表 | 高 | 仅覆盖最终验收操作路径 |
| 自动测试通过 | `186 passed, 22 deselected, 30 subtests passed` | 高 | 跳过项为项目 GPU 标记测试 |

## 截图

1. `01-ai-analysis.png` 显示体裁、4 条角色轨道、7 条分句和 100% 原文覆盖。
2. `02-audio-output.png` 显示人工音色修改、完整音频波形、ZIP、JSON 和成功状态。
3. `03-ui-feedback-and-tables.png` 显示任务状态卡、单行表格和横向滚动布局。
4. `04-ai-role-voices.png` 显示 4 条 AI 角色音色、试听下拉框和音频波形。
5. `05-complete-audio-delivery.png` 显示 16.2 秒完整音频、ZIP、JSON 和成功状态。
6. `06-safe-render-cancel.png` 显示一致的取消状态，交付区没有残留的生成中文案。
