# 证据索引

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| WAV 旁存在 MP3 下载 | `02-download-buttons.png` 与浏览器 DOM | 高 | 当前产品页面 |
| MP3 按请求实时编码 | `product-studio/server/index.mjs` 与真实 HTTP 下载 | 高 | 依赖本机 FFmpeg |
| 输出为 160 kbps MP3 | `ffprobe` 返回 codec mp3、22050 Hz、160000 bps | 高 | 当前完整交付为单声道 |
| 不保存 MP3 副本 | 真实下载后工程目录递归计数为 0 | 高 | 检查当前工程全部目录 |
| 中文下载名兼容 | HTTP `filename*` 与中文 render ID 单元测试 | 高 | 现代浏览器按 RFC 5987 解析 |
| 页面无前端错误 | 浏览器 Console 0 error、0 warning | 高 | 本轮真实页面 |
