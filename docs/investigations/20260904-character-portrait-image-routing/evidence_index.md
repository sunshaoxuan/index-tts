# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 原实现对 Gemini 错用 Images API | 修复前角色形象路由与用户截图中的 `Images API is not supported for this platform` | 高 | 历史请求已结束 |
| Gemini 已切换 Chat Completions | `product-studio/server/image-model-routing.mjs` 的 `compatibleImageGenerationRequest`；容器源码检查 | 高 | 适用于当前兼容平台 |
| 新部署运行中 | 镜像 `indextts25-product-studio:1.1.83-719278a`，revision `719278a9...`，healthy，RestartCount 0 | 高 | 容器状态具有时效性 |
| Gemini 当前无可用供应商账户 | 真实角色请求 HTTP 503，返回 `No available accounts: no available accounts` | 高 | 属于供应商瞬时状态 |
| GPT Image 回退成功 | 真实请求 `req-2v` HTTP 200，34.485 秒；工程保存提示包含 `GPT Image 执行说明` | 高 | 视觉质量由当前生成样本验证 |
| 图片可读取且已保存 | `/role-assets/narrator-1788529104302.png` HTTP 200，`image/png`，1,883,816 字节；工程 JSON 保存同一路径 | 高 | 当前工程专属资产 |
| UI 完整链路通过 | 浏览器显示角色形象，应用设置后保存按钮回到禁用，页面显示“全部修改已保存到工程文件” | 高 | 桌面视口验收 |
| Console 无错误 | 生成前后浏览器 Console 0 error，0 warning | 高 | 当前验收会话 |
