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
