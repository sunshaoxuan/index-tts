# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 产品架构为 React、Ant Design、Node 和 Python Worker | `product-studio`、三个 `product_*_worker.py`、`/api/health` | 高 | 无 |
| 旧 Gradio 产品架构已移除 | Git 删除清单、`pyproject.toml`、`uv.lock` | 高 | 模型推理模块中的历史注释不属于 UI 架构 |
| ORYZO AI 设计已应用 | `product-studio/src/styles.css`、`11-react-oryzo-product-studio.png` | 高 | Halyard 使用 Inter 系统替代字体 |
| 移动端没有文字遮盖 | `12-react-oryzo-mobile.png`、390 x 844 浏览器验收 | 高 | 验收设备为浏览器视口模拟 |
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
