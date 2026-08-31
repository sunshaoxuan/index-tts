# 测试结果

| 检查 | 结果 |
|---|---|
| 聚焦测试 | 13/13 通过 |
| Product Studio 最终全量测试 | 144/144 通过，包含并行进入 master 的大型工程保存测试 |
| TypeScript | 通过 |
| Vite 生产构建 | 3106 个模块，构建通过 |
| Docker | `indextts25-product-studio:1.1.48-b4e4510`，revision `b4e4510f18e486cf4701d54fb359bcd9ca330c0d`，`running`、`healthy`、RestartCount 0 |
| 健康接口 | `status: ok` |
| 采用刷新 | 候选 3 到候选 1时主播放器 URL 改变并重新加载，验收后恢复候选 3 |
| 播放状态 | 就绪、播放中、暂停状态及配色通过真实浏览器检查 |
| Console | error 0、warning 0 |
| 桌面横向溢出 | 0 |
| 390px 横向溢出 | 0 |
