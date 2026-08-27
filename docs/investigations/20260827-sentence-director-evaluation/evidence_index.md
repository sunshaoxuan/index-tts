# 证据索引

## 1. 工程数据

| 证据 | 路径 | 支持的结论 |
|---|---|---|
| 当前项目 | `outputs/novel-projects/20260825-104455-白夜行01-869866/project.json` | 当前 133 条分句、8 个角色、143 次保存及逐次快照 |
| 最早分析结果 | `outputs/novel-projects/20260825-104455-白夜行01-869866/analysis/20260825-104843-5d2e04/result.json` | 首版 98 条分句、6 个角色、情绪和说话人分布 |
| 当前分析任务 | `runtime-output/director-tasks/9bd9602b82b14227b1190e40e5d71b3b/result.json` | Qwen 分析输出与产品导入前结构 |

8 次 Qwen 全文分析的产品任务结果：

| 时间 | 任务目录 | 分句数 | 角色数 |
|---|---|---:|---:|
| 2026-08-25 14:40:23 | `runtime-output/product-jobs/a13728f8f7f2477fa86d718f89b01943` | 98 | 6 |
| 2026-08-25 14:48:46 | `runtime-output/product-jobs/7e6f19eb1dcd4771ab236752cca1e956` | 103 | 7 |
| 2026-08-25 15:43:37 | `runtime-output/product-jobs/ae6cc8429bf1450ba24e807ca902c394` | 98 | 6 |
| 2026-08-25 16:49:18 | `runtime-output/product-jobs/244d30ee0dca47c48a7490680472323b` | 103 | 7 |
| 2026-08-25 18:53:58 | `runtime-output/product-jobs/29437e3f39534deb8c236752cca1e956` | 100 | 7 |
| 2026-08-25 18:59:04 | `runtime-output/product-jobs/e0b8cf9a8e97490c933892c47d41b24d` | 108 | 10 |
| 2026-08-25 19:05:39 | `runtime-output/product-jobs/30f055efd138422984cbf81496ed5b49` | 110 | 7 |
| 2026-08-26 11:18:49 | `runtime-output/product-jobs/6abe56b836bf45019598c0a7229cf547` | 121 | 7 |

## 2. 代码证据

| 位置 | 结论 |
|---|---|
| `text_director.py:158` 至 `text_director.py:176` | segment Schema 使用自由态度字符串和三档 pace |
| `text_director.py:236` | 默认最大分块长度为 1400 字符 |
| `text_director.py:450` 至 `text_director.py:530` | 分块处理和 400 字符前文上下文 |
| `text_director.py:951` 至 `text_director.py:990` | 上下文说话人匹配逻辑 |
| `text_director.py:1294` | pace 预设迁移 |
| `text_director.py:1308` | attitude 预设迁移和回退 |
| `text_director.py:1656` 至 `text_director.py:1685` | 产品级态度与节奏预设校验和转换 |

## 3. 运行态证据

调查时本地页面为 `http://127.0.0.1:7864/`，标题为 Index Voice Studio，产品版本为 1.1.0，当前工程为“白夜行01”。页面显示 133 条分句、8 个角色、143 次导演操作记忆，所有修改已经保存。浏览器 Console 为 0 warning 和 0 error。

本轮没有修改 UI，截图不属于本轮调查完成条件。已有页面运行态用于确认比较对象确实为当前工程。

## 4. 外部资料

1. [GPT 5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
2. [GPT 5.6 模型指南](https://developers.openai.com/api/docs/guides/latest-model)
3. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

外部模型能力只引用 OpenAI 官方资料。模型列表来自当前已连接 Endpoint 的模型发现接口。

## 5. 证据边界

1. 当前 133 条版本已经接近交付，仍需人工确认后才能冻结为金标准。
2. 强度和停顿缺少充分人工调整记录，当前一致不等于质量合格。
3. 场景没有结构化字段，无法直接计算场景准确率。
4. 本轮没有向外部 Endpoint 发送小说正文，因此没有 GPT 模型质量结果。
5. 64 项测试验证结构与规则稳定性，没有验证真实小说导演质量。
