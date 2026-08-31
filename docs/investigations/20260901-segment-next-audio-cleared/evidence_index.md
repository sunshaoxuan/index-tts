# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 旧合并逻辑按序号删除相邻片断 | `product-studio/server/index.mjs` 的 `latest-render` 历史实现 | 高 | 代码证据 |
| 前端按原文和合成文本匹配 | `product-studio/src/fragmentState.ts` | 高 | 代码证据 |
| 插入句后下一条旧交付片断应保留并迁移序号 | `product-studio/server/index.test.mjs` 的插入错位回归 | 高 | 受控 fixture |
| 重复文本必须一对一消费 | `product-studio/server/index.test.mjs` 的重复文本回归 | 高 | 受控 fixture |
| 真实工程从第 78 条开始发生 250 对 249 的序号漂移 | 工程 `20260828030737-白夜行02-2f3ff9` 的当前 `project.json`、最新完整交付 manifest 和过程片断索引 | 高 | 用户数据只读核对 |
