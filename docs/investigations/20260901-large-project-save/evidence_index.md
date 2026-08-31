# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 413 来自工程保存 PUT | 容器日志中的失败 req-87、req-89、req-8d | 高 | 部署前日志 |
| 大型历史快照是主要载荷 | 白夜行02 project.json 字段体积测量 | 高 | 数量会随操作增长 |
| 浏览器不再上传服务端字段 | `product-studio/src/api.ts` 与 `api.test.ts` | 高 | 单元测试与生产浏览器共同验证 |
| 旧页面大型保存能够过渡 | 服务端 26 MiB 兼容测试；生产 req-2u 返回 200 | 高 | PUT 上限保持 64 MiB |
| 分句重生成已经真正执行 | 生产 req-2v 返回 202；任务 `4b55c261a46b42f29cebebe39337b12d` 完成 | 高 | 验收对象为分句 59 |
| 三版音频可加载 | 浏览器 DOM 与四个 audio 元素状态；`artifacts/large-project-save-20260901/segment-59-regeneration-accepted.png` | 高 | 听感由用户试听判断 |
| 审计数据没有丢失 | API snapshot 为 0，磁盘 snapshot 为 213，磁盘 director_memory 存在 | 高 | 当前运行时快照 |
| 容器运行正常 | 镜像 `1.1.47-b4c1cf5`，revision `b4c1cf5...`，healthy，RestartCount 0 | 高 | 运行状态具有时效性 |
