# 图像主模型与互补模型调查报告

## 结论

Product Studio 已支持两个受控图像模型。全局设置保存主模型、互补模型和冷却切换开关。角色图与分镜图可以从主模型开始，请求遇到限流、配额冷却、资源耗尽或临时不可用时尝试另一模型。分镜工作区可以固定本批次请求模型，并决定是否允许切换。

当前兼容 Endpoint 的模型发现结果包含 `gpt-image-2`、`gemini-3-pro-image`、`gemini-3-pro-image-preview`、`gemini-3.1-flash-image`、`gemini-3.1-flash-image-preview`、`gemini-2.5-flash-image` 和 `gemini-2.5-flash-image-preview`。服务没有返回精确 ID `gemini-pro`，产品使用服务实际暴露的模型 ID。

## 行为链

1. `GET` 与 `PUT /api/settings/ai-media` 读写 `image_model`、`image_fallback_model` 和 `image_fallback_enabled`。
2. 前端只允许分镜批次选择当前已保存的主模型或互补模型。
3. `image-model-routing.mjs` 生成候选顺序，维护进程内冷却截止时间，并按实际模型整理提示词。
4. 无画面人物时调用 `/images/generations`。存在画面人物时，每次尝试都重建 `/images/edits` multipart 请求并上传全部原始角色图。
5. 每张结果返回并保存请求模型、实际模型、切换状态、切换原因和提示词规格。

## 失败边界

只有 429、503、`RESOURCE_EXHAUSTED`、限流、配额、冷却和临时过载进入切换链。用户取消、普通 400、参考图格式、Images Edits 能力和内容错误直接返回。该边界用于保护角色容貌参考约束。

## 运行状态

生产容器 `indextts25-product-studio` 已重建并通过健康检查。现有本机配置保持为主模型 `gemini-3.1-flash-image`，互补模型为空，冷却切换关闭。浏览器测试使用临时草稿验证互补模型和警告状态，取消弹窗后未写入运行配置。

## 证据边界

路由、429 切换、冷却跳过、普通错误、提示词规格和参考图上传使用 mock 兼容服务完成自动化验收。真实付费图像生成未执行，状态为 `evidence_missing`。
