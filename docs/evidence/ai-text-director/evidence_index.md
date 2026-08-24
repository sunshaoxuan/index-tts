# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| AI 分析支持小说、新闻、故事和自动识别 | `text_director.py` 的 `CONTENT_TYPES` 与导演提示词 | 高 | 浏览器样本使用小说 |
| 原文覆盖校验和引号恢复有效 | `tests/test_text_director.py`，真实页面显示原文覆盖 100% | 高 | 实质改写仍会拒绝 |
| 旁白、人物和孩子可独立分轨 | `01-ai-analysis.png`，最终 JSON 和 CSV | 高 | 未命名说话者依赖可识别归属文字 |
| 宽表可读且支持横向滚动 | `03-ui-feedback-and-tables.png`，DOM 测量为 1180 px 和 1660 px，`overflow-x:auto` | 高 | 当前验收视口约 1265 px |
| 长任务有阶段反馈和真实取消 | `06-safe-render-cancel.png`，浏览器即时状态与后台进程检查 | 高 | 完整音频在当前分句结束后停止 |
| 2797 字长文本可完成分轨 | `07-long-text-success.png`，2 个文本块、108 条分句、100% 原文覆盖 | 高 | 总处理时间受模型冷启动和文本长度影响 |
| 文本模型获得完整 GPU | Ollama `ps` 显示 `qwen3:8b` 为 100% GPU，日志显示 37/37 层卸载到 GPU | 高 | 只在文本分析阶段释放 IndexTTS |
| 覆盖失败不会终止整篇任务 | `08-coverage-recovery.png`，真实压力文本从 1 块细分至 4 块，3 块安全分段 | 高 | 安全分段局部语义标注需要人工复核 |
| 系统可生成合适角色音色 | `04-ai-role-voices.png`，Qwen3-TTS VoiceDesign 生成 4 条角色参考音频 | 高 | 冷启动和模型恢复耗时较长 |
| IndexTTS 生成完整音频和角色轨道 | `05-complete-audio-delivery.png`，`outputs/director/20260824-195528-雨夜的旧书店` | 高 | 当前为短篇真实样本 |
| ZIP 内容完整 | Python `ZipFile.testzip()` 返回空值，ZIP 包含 14 个交付条目 | 高 | 无 |
| 浏览器控制台正常 | 最终 `tab.dev.logs` 返回空列表 | 高 | 仅覆盖最终验收操作路径 |
| 小说工程保存和重开 | `tests/test_novel_project.py`，真实工程 `20260825-081331-小说工程验收测试-f30069` | 高 | 工程目录由本地文件系统管理 |
| 固定音色跨工程复用 | 12 条历史音色迁移，笹垣润三与内心独白共同引用 `legacy-8f240489d87fa222` | 高 | 旧版音色的原始设计条件未保存并已明确标记 |
| 角色误判可选择修改 | `10-novel-project-delivery.png`，第 3 句改为内心独白，第 7 句改为旁白 | 高 | 需要制作者最终审听 |
| 全篇纠音实际生效 | 最终 manifest 同时记录 `重庆银行` 和 `重 庆 银行` | 高 | 规则为文字级替换，需要按模型分词习惯配置 |
| 章节交付和缓存恢复 | 2 个章节 WAV，第二次生成复用 7/7 分句缓存 | 高 | 首次生成仍受模型速度和 GPU 资源影响 |
| 自动测试通过 | `201 passed, 22 deselected, 30 subtests passed` | 高 | 跳过项为项目 GPU 标记测试 |

## 截图

1. `01-ai-analysis.png` 显示体裁、4 条角色轨道、7 条分句和 100% 原文覆盖。
2. `02-audio-output.png` 显示人工音色修改、完整音频波形、ZIP、JSON 和成功状态。
3. `03-ui-feedback-and-tables.png` 显示任务状态卡、单行表格和横向滚动布局。
4. `04-ai-role-voices.png` 显示 4 条 AI 角色音色、试听下拉框和音频波形。
5. `05-complete-audio-delivery.png` 显示 16.2 秒完整音频、ZIP、JSON 和成功状态。
6. `06-safe-render-cancel.png` 显示一致的取消状态，交付区没有残留的生成中文案。
7. `07-long-text-success.png` 显示 2797 字长文本、2 个文本块、4 条角色轨道、108 条分句和 100% 原文覆盖。
8. `08-coverage-recovery.png` 显示覆盖失败自动细分、安全分段块计数和最终 100% 原文覆盖。
9. `09-novel-project.png` 显示小说工程、固定音色库、角色选择器、中文表达节奏和全篇纠音表。
10. `10-novel-project-delivery.png` 显示 2 章节、4 角色、7 分句、30 秒完整音频和 7/7 缓存复用交付结果。
