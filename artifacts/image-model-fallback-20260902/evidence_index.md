# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 主模型与互补模型可以持久化 | `product-studio/server/index.test.mjs` 设置测试 | 高 | 使用隔离临时目录 |
| 429 后切换到 Gemini | `product-studio/server/index.test.mjs` 429 参考图测试 | 高 | mock 兼容服务 |
| 冷却中的主模型会直接跳过 | `product-studio/server/image-model-routing.test.mjs` | 高 | 进程内时间由测试时钟控制 |
| 普通 400 不切换 | `product-studio/server/index.test.mjs` 参考图拒绝测试 | 高 | mock 兼容服务 |
| 切换后继续上传角色参考图 | `product-studio/server/index.test.mjs` multipart 字段和字节断言 | 高 | mock 兼容服务 |
| GPT 与 Gemini 使用不同提示词规格 | `product-studio/server/image-model-routing.test.mjs` 与集成请求断言 | 高 | 未对付费模型输出做视觉评分 |
| 桌面设置区可配置双模型 | `ai-settings-fallback-enabled-desktop.png` | 高 | 草稿取消后未保存 |
| 分镜页可选择批次模型 | `storyboard-model-controls-desktop.png` | 高 | 当前运行配置只有主模型 |
| 390 像素布局无横向溢出 | `storyboard-model-controls-mobile.png`、`ai-settings-image-routing-mobile.png`、浏览器宽度测量 | 高 | 单一移动视口 |
| 浏览器 Console 无错误 | 应用内浏览器 `dev.logs` | 高 | 验收页面范围内 |
| 生产服务健康 | `/api/health` 与容器健康状态 | 高 | 验收时间点快照 |
| 真实付费生图 | `evidence_missing` | 低 | 本次未产生外部图像费用 |

## 截图 SHA256

* `ai-settings-fallback-enabled-desktop.png`: `9EB7BC4DFC459009B61A1E7FBF3F1B1938E73FDAE4D537D4B584AE92011D5C52`
* `ai-settings-image-routing-mobile.png`: `CD15CFE005D5CDFE386F6819DDA85B3DEDEF96569D2B1EB320AD5966ECB8DB69`
* `storyboard-model-controls-desktop.png`: `5DCEC6AC71F8412EE3D85AE37B6704264BFDBB3CA9FFBA543221B15E215BDD85`
* `storyboard-model-controls-mobile.png`: `53B5FD66A607A3279873BF34F7D79CF5181A52A44B55FA6A581C81FA47BEE3DF`
