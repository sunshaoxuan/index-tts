# 角色形象生成接口错误调查报告

## 用户故障

工程 `20260904043536-成都粉子-5b71f8` 的角色资产卡片在生成形象时显示 `Images API is not supported for this platform`。

## 根因

运行配置选择了 `gemini-3.1-flash-image`。兼容平台可以在模型发现接口中列出该模型，但原实现仍固定调用 `/v1/images/generations`。模型可发现性只能证明模型 ID 可用，不能证明该模型支持 Images API 传输契约。

Gemini 图像模型应使用图像响应模态。当前兼容平台通过 `/v1/chat/completions` 提供该能力。Google 官方文档也把 Gemini 3.1 Flash Image 定义为多模态图像生成模型，并要求在生成配置中指定图像响应格式或模态。

## 修复

提交 `719278a9a24bcea56382e885aaf9d52147b006b8` 增加按模型族选择图像传输：

1. Gemini Image 使用 `/chat/completions` 和图像响应配置。
2. GPT Image 与普通兼容图像模型继续使用 `/images/generations`。
3. 统一解析 `b64_json`、远程 URL、Data URL、Chat Completions 图像数组和 Gemini inline data。
4. 角色形象与无人物参考图的分镜关键帧复用同一模型族路由。
5. 含人物参考图的关键帧继续使用 `/images/edits`，保留身份参考门禁。

提交 `0a777b6` 把 Product Studio 部署镜像更新为 `1.1.83-719278a`。

## 真实运行结果

新容器启动后，原始按钮请求不再返回 Images API 不支持错误。第一轮真实请求进入 Gemini Chat Completions，供应商返回 HTTP 503：`gemini-3.1-flash-image No available accounts: no available accounts`。这属于供应商账户池暂时不可用。

全局运行配置随后保留 Gemini 为主模型，将已发现的 `gpt-image-2` 配置为互补模型并启用 503 冷却切换。重新从旁白角色卡片生成后，系统自动使用 GPT Image 完成生成：

| 项目 | 结果 |
|---|---|
| 角色形象请求 | HTTP 200，34.485 秒 |
| 生成模型证据 | 保存提示以 `GPT Image 执行说明` 开头 |
| 图片资源 | HTTP 200，`image/png` |
| 图片大小 | 1,883,816 字节 |
| 页面状态 | 显示旁白角色形象，重新生成按钮可用 |
| 工程状态 | 应用角色设置并保存，页面显示全部修改已保存 |
| 浏览器 Console | 0 error，0 warning |
| 容器状态 | healthy，RestartCount 0 |

## 结论

原始故障的根因是图像模型族与传输接口未匹配。代码路由已修复并部署。当前 Gemini 供应商账户池仍会产生临时 503，运行配置中的 GPT Image 互补模型已让该故障自动恢复，角色形象已经生成并保存。

## 外部依据

Google 官方 Gemini 图像生成文档：<https://ai.google.dev/gemini-api/docs/image-generation>

