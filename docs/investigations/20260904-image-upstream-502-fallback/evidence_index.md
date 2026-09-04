# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 截图中的失败来自角色形象 API | 请求 `req-g6`，`POST /api/projects/20260904043536-成都粉子-5b71f8/roles/role_004/portrait`，HTTP 502 | high | 请求发生于修复前 |
| Product Studio 当时没有重启 | 容器 healthy，RestartCount 0，连续运行 | high | 只证明本机容器状态 |
| 旧回退遗漏 502 | 修复前 `image-model-routing.mjs` 只按 429、503 和文本信号回退 | high | 无 |
| 502 现在会调用互补模型 | `server/index.test.mjs` 的 Gemini HTML 502 角色形象测试 | high | 受控远端响应 |
| 上游 5xx 最终以 424 JSON 返回浏览器 | `compatibleServiceError` 与 `requestErrorStatus` 代码及测试 | high | 公网代理行为需部署后复核 |
| 前端提示不再宣称服务重启 | `src/api.ts` 与 `src/api.test.ts` | high | 需部署后浏览器复核 |
| 全套回归通过 | 221 项 Node 测试、TypeScript、Vite build、Compose config | high | 运行时验收另行记录 |
| 当前生产可以生成小燕子形象 | 待部署后真实浏览器请求和截图 | pending | evidence_missing |
