# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| AI 分析支持小说、新闻、故事和自动识别 | `text_director.py` 的 `CONTENT_TYPES` 与导演提示词 | 高 | 浏览器样本使用小说 |
| 原文覆盖校验和引号恢复有效 | `tests/test_text_director.py`，真实页面显示原文覆盖 100% | 高 | 实质改写仍会拒绝 |
| 旁白、人物和孩子可独立分轨 | `01-ai-analysis.png`，最终 JSON 和 CSV | 高 | 未命名说话者依赖可识别归属文字 |
| 音色映射可人工编辑 | `02-audio-output.png`，清单中李明为 `voice_04.wav` | 高 | 自定义上传音色由单元路径校验覆盖 |
| IndexTTS 生成完整音频和角色轨道 | `outputs/director/20260824-180814-雨夜` | 高 | 当前为短篇真实样本 |
| ZIP 内容完整 | Python `ZipFile.testzip()` 返回空值，ZIP 包含 14 个交付条目 | 高 | 无 |
| 浏览器控制台正常 | 最终 `tab.dev.logs` 返回空列表 | 高 | 仅覆盖最终验收操作路径 |
| 自动测试通过 | `178 passed, 22 deselected, 30 subtests passed` | 高 | 跳过项为项目 GPU 标记测试 |

## 截图

1. `01-ai-analysis.png` 显示体裁、4 条角色轨道、7 条分句和 100% 原文覆盖。
2. `02-audio-output.png` 显示人工音色修改、完整音频波形、ZIP、JSON 和成功状态。
