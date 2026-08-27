# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 交付分句资源足以建立精确时间轴 | `outputs/novel-projects/20260825-104455-白夜行01-869866/renders/20260827-132033-771000-未命名内容/director-manifest.json` 与 `segments/*.wav` | 高 | 针对当前真实交付核对 |
| 字幕累计时长与完整 WAV 一致 | 源码接口注入核对，差值约 0.00045 秒 | 高 | WAV 容器时间存在浮点舍入 |
| 接口返回角色、原文、时长与停顿 | `product-studio/server/index.mjs` 与 `product-studio/server/index.test.mjs` | 高 | 非 WAV 片段会被安全跳过 |
| 播放和进度输入驱动字幕定位 | `product-studio/src/App.tsx` 与 `product-studio/src/subtitleTimeline.ts` | 高 | 浏览器自动化使用 range fill 触发标准 input 行为 |
| 中段与末尾定位和滚动通过 | `artifacts/delivery-subtitles/browser-mid-seek.png`、`artifacts/delivery-subtitles/browser-end-seek.png` | 高 | 本地验收截图未纳入 Git |
| 浏览器 Console 无问题 | 7864 真实页面浏览器日志检查，0 warning，0 error | 高 | 当前验收会话范围 |
