# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 产品架构为 React、Ant Design、Node 和 Python Worker | `product-studio`、三个 `product_*_worker.py`、`/api/health` | 高 | 无 |
| 旧 Gradio 产品架构已移除 | Git 删除清单、`pyproject.toml`、`uv.lock` | 高 | 模型推理模块中的历史注释不属于 UI 架构 |
| ORYZO AI 摄影产品设计已应用 | `product-studio/src/styles.css`、`product-studio/public/hero-voice-workbench.png`、`14-photo-hero-clear.png` | 高 | Halyard 使用 Inter 系统替代字体 |
| 滚动过程连续模糊且工作区透明 | `15-photo-hero-transition.png`、`16-transparent-workspace.png` | 高 | 浏览器滚动状态截图 |
| 顶部导航不会覆盖工作区 | `17-header-clear-workspace.png`、浏览器几何测量 | 高 | 桌面视口 1294 x 912 |
| 移动端没有文字重叠或页面横向溢出 | `18-mobile-workspace-no-overlap.png`、390 x 844 浏览器验收 | 高 | 验收设备为浏览器视口模拟 |
| 透明角色表保持可读和可操作 | `19-transparent-roles-table.png`、角色枚举实际展开 | 高 | 表内提供横向滚动 |
| 透明分句表保持可读和可滚动 | `20-transparent-director-table.png`、浏览器宽度测量 | 高 | 表内提供横向滚动 |
| AI 任务 POST 不再返回空 JSON 400 | `product-studio/src/api.ts`、Fastify 真实请求 202 | 高 | 分析、音色和渲染共用同一请求形态 |
| 白夜行长文本真实分析完成 | 任务 `a13728f8f7f2477fa86d718f89b01943`、`status.json`、`result.json` | 高 | 3 块，188.449 秒 |
| 半透明阅读层提供文字边界 | `21-tinted-workspace-ai-success.png`、`22-mobile-tinted-workspace.png` | 高 | Bark Brown 透明渐变 |
| 前景进度面板在 0% 清晰可见 | `23-foreground-progress-version-lock.png`、浏览器几何测量 | 高 | 显示真实 0%，轨道使用最小活动填充 |
| 角色表在任务期间只读 | `24-locked-role-table.png`、浏览器 disabled 计数 | 高 | 任务终态自动恢复 |
| 移动端进度面板完整可见 | `25-mobile-foreground-progress.png`、390 x 844 几何测量 | 高 | 无横向溢出 |
| 服务端保证任务版本唯一 | Node 409 回归测试、生产任务 `47947e1a0d284c9a88b88b550a02d0b0` | 高 | 锁定粒度为活动工程 projectId |
| 角色音色可行内播放和拖动 | `26-inline-voice-player.png`、浏览器播放暂停和 4.2 秒定位 | 高 | 使用实际 `voice_05.wav` |
| 音色接口支持进度定位 | Node Range 206 测试、`/api/voices/:voiceId/audio` | 高 | 限制演示和永久音色 ID 模式 |
| 下拉菜单滚动不带动页面 | `27-contained-select-scroll.png`、顶部和底部滚动边界测量 | 高 | 菜单关闭后恢复页面滚动 |
| 移动端音色播放器可通过表内滚动访问 | `28-mobile-inline-voice-player.png`、390 x 844 浏览器测量 | 高 | 页面无横向溢出 |
| 有限字段为原生枚举 | 角色节奏和分句态度的真实展开 DOM、Node 枚举 API | 高 | 高级音色提示按模型能力保留自由文本 |
| 旧工程有限值可迁移 | Node 测试 `migrates legacy natural language controls` | 高 | 使用确定性关键词映射 |
| 保存失败不会继续启动任务 | `App.tsx` 的布尔保存门 | 高 | 前端构建验证 |
| GPU 任务互斥且失败进入终态 | Node 测试 `allows one worker at a time` | 高 | 单进程 Node 服务范围 |
| 完整音频 Worker 可交付 | 任务 `c14b50175d924af585526f0824e54207` 结果 | 高 | 本次使用 7 条已有缓存 |
| 浏览器无 Console 问题 | Browser 日志查询为空数组 | 高 | 本次页面会话 |
| 新架构 Ollama 全文分析 | 任务 `42d0815f89f24bec8bc7252c88b7228a` | 高 | 本次触发无损安全分段 |
| 全新 VoiceDesign 与音色幂等 | 任务 `ec91393b612a41cd9541f25f9a40977a`，二次签名复用结果 | 高 | 共 2 个角色 |
| 新音色完整渲染 | 任务 `ba7bd3615a474f31bff154d80bd03e7d` | 高 | 5 条分句的短篇工程 |
| 真实交付在产品页面可见 | `13-react-real-delivery.png` | 高 | 页面显示音频播放器和两个下载入口 |
| 产品端口固定且自动清理占用 | `scripts/start_indextts25_windows.ps1`、正式重启日志 | 高 | Windows 专用启动器 |
| 浏览器刷新恢复同一活动作业 | `/api/active-job`、任务 `e0f20b083101444db5a7aae8665c0d32`、`29-refreshed-active-job-lock.png` | 高 | 正常浏览器刷新场景 |
| 移动端刷新保持进度与只读锁 | 任务 `26d53ff6946e492c843047cae3f83ca6`、`30-mobile-refreshed-active-job-lock.png` | 高 | 390 x 844 模拟视口 |
| 服务恢复区分存活与失联 Worker | Node 测试 `restores a running worker after the server is rebuilt`、`marks a restored job as failed when its worker no longer exists` | 高 | PID 存活探测，无法识别极少数 PID 重用场景 |
| 角色编辑清楚区分人物与声音依据 | `31-role-biography-voice-editor.png`、`App.tsx` 最终指令预览 | 高 | 小传质量仍取决于原文证据和 AI 结果 |
| 旧姓名占位不会继续送入 VoiceDesign | Node 测试 `replaces name-only character metadata`、白夜行真实 DOM | 高 | 读取时迁移，保存工程后持久化 |
| VoiceDesign 使用可见的完整依据 | `build_voice_design_jobs`、Python 指令契约测试、编辑窗口六类依据 | 高 | 浏览器预览由同值映射同步维护，测试校验关键字段 |
| 移动端人物编辑没有横向溢出 | `33-mobile-role-biography-editor.png`、窗口与页面宽度测量 | 高 | 390 x 844 模拟视口 |
| 低声说不会把低声当人物名 | 任务 `b8965e4b87954f5db7bfa7e2a1e40b1c`、`test_quoted_speaker_inference...` | 高 | 当前确定性规则覆盖常见动作和语气词 |
| 角色节奏长标签不覆盖重新生成控件 | `34-role-editor-controls-no-overlap.png`、`35-narrow-role-editor-controls-no-overlap.png`、`36-mobile-role-editor-controls-no-overlap.png`、三档矩形检测 | 高 | 覆盖 1280、820、390 像素视口与真实最长节奏标签 |
| 导演补充由 AI 语义路由到目标轨道 | 任务 `76d05463c67e46278898257b542d3695`、工程 `document.guidance_routing`、截图 37 和 38 | 高 | 本地模型为 qwen3:8b；生成前每次重算 |
| AI 路由能处理姓名和人物小传指代 | 只读真实调用“笹垣说话更疲惫”“经营烤乌贼饼摊位的女性声音更温和” | 高 | 分别分配到 role_001 和 role_002 |
| 明确点名角色不能扩散成全局 | 首次真实错误结果、`validate_guidance_assignments`、自动重试后的正确结果 | 高 | 确定性规则用于验证 AI 输出范围 |
| 女性角色拒绝明显男声音色 | 原老板娘 89.5 Hz、原死者妻子 76.7 Hz；新音色 165.5 Hz 和 155.9 Hz；Worker 重试测试 | 高 | 基频用于明显错配防线，不能描述全部性别表现差异 |
| 第 103 行角色可以跨页修改 | `segmentState.ts`、Node 类型剥离测试、`39-segment-role-edit-saved-reloaded.png` | 高 | 白夜行真实第 6 页 |
| 角色修改同步 ID 与名称并持久化 | `/api/projects/20260825-104455-白夜行01-869866` 返回 `narrator / 旁白`、保存刷新复查 | 高 | 本次修正第 103 行 |
| 角色列表可见且可选择 | `40-segment-role-select-options.png`、7 个真实角色选项、`select-popup-open=true` | 高 | 桌面浏览器视口 |
| 句内招牌名称不再独立分句 | `test_ai_analysis_keeps_short_quoted_sign_name_inside_narrator_sentence`、`_merge_inline_quoted_narration` | 高 | 当前启发式覆盖 24 字以内短引用 |
| 无标点短对白仍保持人物分轨 | `test_ai_analysis_keeps_short_unpunctuated_dialogue_as_character_speech` | 高 | 依赖左侧明确说话动作 |
| 同句多个引号逐对区分 | `test_ai_analysis_pairs_multiple_quotes_and_distinguishes_sign_from_dialogue`、白夜行旧工程只读重组覆盖检查 | 高 | 旧工程只读检查未写回文件 |
| 常用引号样式使用相同短引用规则 | `test_ai_analysis_keeps_common_inline_quote_styles` 四组参数 | 高 | 覆盖中文单引号、两类直角引号和 ASCII 双引号；中文双引号由真实原句覆盖 |
| 预拆短对白继承已知角色 | `test_pre_split_unpunctuated_dialogue_inherits_profile_alias_speaker` | 高 | 上下文需有说话动作和可匹配角色身份 |
| 人物小传别名阻止方式状语伪角色 | `test_embedded_dialogue_uses_profile_alias_without_creating_adverb_role` | 高 | 当前身份词表覆盖常见职业与关系称呼 |
| 白夜行最终真实分析符合短引用规则 | 任务 `30f055efd138422984cbf81496ed5b49`、`41-inline-quoted-reference.png` | 高 | 5 个文本块，安全回退 0 |
| 招牌引用和人物对白同时正确 | `42-inline-sign-and-dialogue.png`、项目 API 第 22 与 24 行 | 高 | 招牌为旁白，多谢为 role_002 |
| 老板娘两条对白复用已有角色 | 项目 API 第 20、24 行与最终 7 条角色表 | 高 | AI 角色名为中年妇人，小传含店铺老板娘 |
| 纯标点不会独立形成音频段 | `_merge_punctuation_only_segments`、文本导演 45 项聚焦测试 | 高 | AI 输出后执行验收和有限安全修复 |
| 连续同轨分句可多选合并 | `mergeAdjacentSegments`、截图 43、真实 5 条合并为 4 条并保存重载 | 高 | 跨章节、角色或语言时拒绝 |
| 单条可按原文光标拆分 | `splitSegmentAtOffset`、截图 44 与 46、真实 4 条拆分为 5 条 | 高 | 两侧均须包含 Unicode 字母或数字 |
| 合并拆分保持编号与停顿契约 | Node 17 项测试、浏览器前半句 250 ms 与后半句 300 ms | 高 | 合成文本拆分后可继续手工编辑 |
| 非相邻和跨角色合并有门禁 | 浏览器提示“只能合并连续相邻的分句”与“跨角色分句不能直接合并，请先统一角色” | 高 | 错误路径数据保持 5 条 |
| 分句结构编辑可保存和刷新恢复 | 截图 45、工程 PUT、刷新后重新打开专用工程 | 高 | 刷新默认工程排序属于既有选择行为 |
| 移动端拆分窗口无横向溢出 | `46-segment-split-mobile.jpg`、390 x 844 浏览器几何测量 | 高 | `clientWidth=scrollWidth=390` |
