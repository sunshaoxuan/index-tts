# 分句导演改造实施报告

## 实施范围

本阶段把调查结论转化为产品实现，覆盖全局 AI 设置、角色删除、角色与场景注册、低置信度说话人复核、产品级导演枚举、分阶段分析和金标准评测基础。

## 已实现能力

1. 工程控制区提供全局 AI 设置。所有工程共用全文导演 Provider、模型、Ollama Endpoint、分析块长度、兼容 Endpoint、API Key、兼容文本接口、人物小传模型和图像模型。
2. 全文导演支持本地 Ollama 与 OpenAI 兼容 Endpoint。兼容模式支持 Responses API 和 Chat Completions Structured Outputs。分析任务文件不保存 API Key，Python Worker 从本机设置文件读取。
3. AI 分析先建立全文角色与场景注册表，再进行逐块分句。角色增加别名、置信度和证据；场景增加地点、时间、参与角色、叙事视角、基调和证据；分句增加场景 ID、说话人候选、置信度和证据。
4. 态度与句内节奏的 AI Schema 直接使用产品预设 ID。详细人物小传移出分句请求预算。
5. 场景分析页支持复核场景字段并显示低置信度说话人。当前旧工程尚无场景结构时显示明确空状态。
6. 除旁白外的角色可以删除。删除确认显示受影响分句数；工程内分句引用重分配到旁白，同时清理角色表、角色资产、AI 文档和导演记忆中的活动关联。
7. 增加分句导演评测工具，可计算边界精确率、召回率、F1 和完全相同区间的字段一致率。

## 运行边界

当前“白夜行01”保留人工调整后的 133 条分句和 8 个角色，本阶段没有执行 AI 重新分析，也没有删除实际角色。场景页显示旧工程无场景结构，下一次由用户主动重新分析后才会生成新版角色与场景数据。

当前全局全文导演仍选择本地 `qwen3:8b`。实时模型发现确认本机 Ollama 提供 `qwen3:8b`、`qwen3:14b` 和 `qwen3-embedding:8b`。外部 Endpoint 的生产切换仍应基于后续固定金标准盲测结果。

## 验收摘要

1. Python 非 GPU 测试 275 项通过，22 项 GPU 测试按标记排除，另有 30 个子测试通过。
2. Node、React 与 TypeScript 测试 69 项通过。
3. TypeScript 构建与 Vite 生产构建成功。
4. 产品服务已在 `0.0.0.0:7864` 运行，健康接口正常，已有片断重生成任务在服务重启后继续可查询。
5. 浏览器复验全局设置、角色删除确认、取消后的事件隔离和场景复核页。Console 为 0 warning 和 0 error。

## 截图证据

1. `artifacts/sentence-director-20260827/global-ai-settings-final.png`
2. `artifacts/sentence-director-20260827/role-delete-confirmation-final.png`
3. `artifacts/sentence-director-20260827/scene-review-final.png`
