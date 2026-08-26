# Changelog

本文件记录 IndexVoiceStudio 的产品版本。版本格式遵循 [Semantic Versioning](https://semver.org/)。IndexTTS 推理引擎保留独立版本号。

## [1.0.0] 2026-08-26

首个正式公开版本。

### Added

* React 19、Ant Design 6 和 Fastify 5 构成的本地长文本声音制作工作台。
* 小说、故事和新闻工程的完整原文、章节、人物、分句、纠音和导演参数持久化。
* Ollama `qwen3:8b` 全文导演、角色识别、语义断句和导演补充路由。
* Qwen3 TTS VoiceDesign 角色音色生成、模型健康门禁和永久音色库。
* IndexTTS 2.5 常驻渲染运行时和连续逐句生成模型复用。
* 分句合并、拆分、合成文字编辑、角色分配、情绪、节奏和停顿控制。
* 已生成片断加载、逐句重新生成和严格缓存串接。
* 导演操作历史记录和稿件调整后的智能重应用。
* 完整 WAV、章节音频、角色分轨、ZIP、JSON 清单和实时 MP3 下载。
* 完整交付过期标记、保留与用户确认删除。

### Changed

* 分句和纠音变化按实际影响范围使缓存失效，未受影响片断继续复用。
* 合成文本修改立即进入未保存状态，保存结果在工程控制区和分句导演区可见。
* 产品版本与 IndexTTS 引擎版本分离，IndexVoiceStudio 从 `1.0.0` 开始使用语义版本。

### Fixed

* 修复 Qwen TTS 环境或模型文件缺失时错误出现过晚的问题。
* 修复 Windows 运行时 stale PID、模型重复加载和 GPU 模型内存竞争。
* 修复同一秒内快速连续生成时交付目录名称碰撞的问题。
* 修复旧交付片断按历史序号绑定到新分句的问题。
* 修复中文交付名称用于 MP3 下载响应头时的兼容问题。
* 修复分句导演滚动越界带动页面和保存按钮状态不明确的问题。

## [0.9.0] 2026-08-25

### Added

* 持久化小说工程、版本化完整交付和任务恢复。
* React 与 Ant Design 产品界面、角色试听、分句分页编辑和移动端布局。
* 人物小传、声音条件、角色导演和性别约束。
* 分句合并、拆分、纯标点门禁和短引用语义处理。

### Fixed

* 修复刷新后活动任务丢失、角色编辑跨页错位和控件重叠。
* 修复 AI 分句覆盖不完整、引号片断误拆和导演补充进入错误角色。

## [0.8.0] 2026-08-24

### Added

* AI 长文本导演、角色分析、分句和 Qwen3 TTS VoiceDesign 链路。
* 长文本分块、覆盖验证、自动重试和安全恢复。

### Fixed

* 修复全文导演结果遗漏、改写或重排原文时缺少恢复路径的问题。

## [0.1.0] 2026-08-13

### Added

* Windows IndexTTS 2.5 本地运行环境。
* 初始生产声音工作台、示例音色和情绪控制。
* 本地模型、输出和运行目录的 Git 排除规则。

[1.0.0]: https://github.com/sunshaoxuan/IndexVoiceStudio/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/sunshaoxuan/IndexVoiceStudio/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/sunshaoxuan/IndexVoiceStudio/compare/v0.1.0...v0.8.0
[0.1.0]: https://github.com/sunshaoxuan/IndexVoiceStudio/releases/tag/v0.1.0
