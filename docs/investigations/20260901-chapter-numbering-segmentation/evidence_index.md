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
| 三个实际工程已持久化为统一章节 | 三个 `project.json` 中 `segments` 与 `director_memory.segments` 的唯一章节值均为“第 1 章” | 高 | 运行数据未纳入 Git |
| 白夜行01视觉显示为短编号 | `artifacts/chapter-numbering-segmentation/white-night-01-chapter-rows.png` | 高 | 截图覆盖第一页 |
| 白夜行03原长台词章节已消失 | `artifacts/chapter-numbering-segmentation/white-night-03-chapter-rows.png`，第一页 20 行均显示“第 1 章” | 高 | 截图覆盖第一页，全部 154 行由物理数据复核覆盖 |
| 当前生产运行正常 | `1.1.51-705fd39` 的 Docker inspect 为 running、healthy、RestartCount 0，`/api/health` 为 ok | 高 | 验收时点快照 |
| 当前生产镜像仍正确显示章节 | `artifacts/chapter-numbering-segmentation/white-night-03-current-production-rows.png` | 高 | 截图覆盖第一页，物理数据复核覆盖全部 154 行 |
