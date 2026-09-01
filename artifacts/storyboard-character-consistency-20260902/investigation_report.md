# 分镜角色参考图与人物一致性调查报告

## 结论

原实现只把参与人物的名称、性别、年龄和人物小传写入文字提示，角色卡中的 `portrait_url` 没有进入关键帧请求。当前改动建立了角色身份参考图链路：镜头存在非旁白画面角色时，服务端读取对应角色原始图片，通过 `/v1/images/edits` multipart 多图请求生成关键帧；没有画面角色时继续使用 `/v1/images/generations`。

## 当前行为路径

1. 从镜头 `participants` 读取稳定角色 ID。
2. 依据工程角色表固定参考图顺序并排除 `narrator`。
3. 从 `character_assets[roleId].portrait_url` 解析当前工程或关联工程的本地 `role-assets` 文件。
4. 校验图片存在、大小不超过 20 MB，格式为 PNG、JPEG 或 WebP，并计算 SHA256。
5. 在提示中逐张绑定参考图序号、稳定角色 ID 和名称，约束面部结构、五官比例、发型、年龄感和标志特征。
6. 以重复 `image[]` 字段调用 Images Edits。每个镜头直接使用原始角色图，避免关键帧递推产生累积漂移。
7. 保存 `identity_reference_mode`、参考角色 ID、名称、角色图 URL 和 SHA256。
8. 页面显示最近实际使用的参考角色、当前可用状态或缺失项。

## 门禁

画面人物缺少角色形象、参与人物 ID 未登记、图片不可读、图片格式异常或兼容服务拒绝 Images Edits 时，请求返回具体错误。全量生成在第一张图片请求前预检全部镜头。系统不会静默退回纯文字生成人物镜头。

## 官方接口依据

OpenAI 官方文档确认 GPT Image 2 支持图片输入和图片编辑，Images Edits 支持多张参考图片，multipart 使用重复 `image[]` 字段。GPT Image 2 的图像输入自动以高保真处理，接口不接受可调的 `input_fidelity`，因此实现省略该字段。

参考：

* https://developers.openai.com/api/docs/models/gpt-image-2
* https://developers.openai.com/api/docs/guides/image-generation

## 限制

角色参考图与明确身份映射能够显著约束重复人物的视觉身份。图像模型仍可能在复杂多人构图、极端角度或大幅表情变化时出现一致性波动。产品保存参考图 SHA256 和角色映射，便于识别每张关键帧实际使用的身份锚点。

真实外部 `/images/edits` 生成会产生图像输入和输出费用，本次未触发该付费调用，状态为 `evidence_missing`。multipart 合约、文件字节、顺序、错误分支和 UI 状态已经通过 mock、运行时页面和截图验证。
