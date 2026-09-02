# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 当前真实工程在连续生成期间执行了两次拆分 | `project.json` 的最近导演历史与 `runtime-output/product-jobs` 最近任务状态 | 高 | 用户数据只读核对 |
| 拆分让已有下一句保留旧序号并后移 | 最近三份导演历史快照中分句 14 至 18 的文本顺序 | 高 | 历史快照证据 |
| 接口读取阶段会按序号提前丢弃过程片断 | `product-studio/server/index.mjs` 的 `latestDraftByOrder` | 高 | 代码证据 |
| 现有回归遗漏接口读取阶段 | `product-studio/server/index.test.mjs` 仅直接调用 `reconcileFragmentsToProject` | 高 | 测试覆盖证据 |

