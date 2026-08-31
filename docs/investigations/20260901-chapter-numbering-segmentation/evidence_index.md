# 证据索引

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| 前端原样显示章节文本 | `product-studio/src/App.tsx` 的 `row[1]` 显示路径 | 高 | 无 |
| AI 原本可逐句自由生成章节 | `text_director.py` 的 `DIRECTOR_SCHEMA`、`_normalize_segment` 和 `document_to_tables` | 高 | 无 |
| 章节音频按 `section` 分组 | `text_director.py` 的 `render_directed_audio` | 高 | 无 |
| 新规则按原文正式标题分章 | `product-studio/server/chapterSections.mjs` 和 `novel_project.py` | 高 | 无 |
| 历史工程读取和保存都会规范章节 | `product-studio/server/index.mjs` 与 `index.test.mjs` | 高 | 无 |
| AI 新分析会覆盖模型自由章节 | `text_director.py` 与 `tests/test_text_director.py` | 高 | 无 |
| 三个实际工程均无正式章节标题 | `D:\workspace\IndexTTS-2.5\outputs\novel-projects\*\project.json` 只读试算 | 高 | 源数据未纳入 Git |
