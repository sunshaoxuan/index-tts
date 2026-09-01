# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 原实现未发送角色图片 | `product-studio/server/index.mjs` 的历史差异与当前 `/images/generations` 无人物分支 | 高 | 当前文件已被修复，历史状态以 Git 差异为准 |
| 有人物镜头发送多张角色参考图 | `product-studio/server/index.mjs` 的 `resolveSceneCharacterReferences`、`callCompatibleImageEdit`、`generateSceneKeyframe` | 高 | 真实外部付费请求为 `evidence_missing` |
| 单张与全量使用同一身份解析链 | 三个关键帧路由统一调用 `generateSceneKeyframe`，全量先调用同一预检函数 | 高 | 无 |
| 支持关联工程角色图片 | `server/index.test.mjs` 的 `linked-source` 角色图片测试 | 高 | 使用本地 fixture |
| 旁白不进入图片参考 | 多角色请求测试中的 `narrator` 排除断言 | 高 | 无 |
| 缺图在全量请求前阻断 | 缺图预检测试断言远端调用次数为 0 | 高 | 无 |
| 服务拒绝编辑时不降级 | 501 mock 测试只记录一次 `/images/edits` 调用 | 高 | 无 |
| 保存参考角色与 SHA256 | API 测试与 `SceneKeyframeResult` 类型 | 高 | 无 |
| 桌面与移动页面提示、按钮门禁正常 | `storyboard-identity-desktop-final.png`、`storyboard-identity-ready-final.png`、`storyboard-identity-mobile-final.png` | 高 | 使用隔离运行 fixture |
| 页面 Console 清洁 | 浏览器日志检查 error 0、warning 0 | 高 | 隔离容器端口 7865 |
| 官方 GPT Image 2 支持多图编辑 | OpenAI 官方模型页与图像生成指南 | 高 | 兼容服务实现能力仍需真实请求确认 |
