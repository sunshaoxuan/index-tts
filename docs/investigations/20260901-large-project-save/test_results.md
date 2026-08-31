# 测试结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 聚焦测试 | 通过 | 48/48 |
| Product Studio 全量测试 | 通过 | 144/144 |
| TypeScript 与 Vite 构建 | 通过 | 3106 modules transformed |
| 26 MiB 旧页面请求兼容 | 通过 | PUT 200，响应小于 1 MiB，磁盘 snapshot 保留 |
| 正式容器健康 | 通过 | running、healthy、RestartCount 0 |
| 正式大型工程保存 | 通过 | PUT 200，约 1.137 秒 |
| 正式分句重生成 | 通过 | POST 202，任务 complete |
| 新片断与三版候选 | 通过 | 四个 audio 均 readyState 4 |
| 浏览器控制台 | 通过 | error 0，warning 0 |
| 截图 | 通过 | `artifacts/large-project-save-20260901/segment-59-regeneration-accepted.png` |
| 宿主与容器源码 | 通过 | 两个关键源码 SHA256 分别一致 |

构建保留既有前端 chunk 大小告警，该告警与本次保存和重生成链路无关。
