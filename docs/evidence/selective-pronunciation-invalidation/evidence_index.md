# 证据索引

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| 原因是纠音变化触发全量失效 | `product-studio/server/index.mjs` 的旧 `invalidateAll` 条件 | 高 | 已由当前修复替换 |
| JS 纠音比较与 Python 合成语义一致 | `product-studio/server/index.mjs` 的 `applyPronunciations`，`novel_project.py` 的 `apply_pronunciations` | 高 | 由重叠规则测试覆盖 |
| 未命中规则保留全部片断 | `product-studio/server/index.test.mjs` 的 `keeps every generated fragment...` | 高 | 使用隔离测试工程 |
| 单句命中只失效单句 | `product-studio/server/index.test.mjs` 的 `invalidates only the fragment...` | 高 | 使用隔离测试工程 |
| 未受影响交付保持有效 | 同一单句命中测试中的 `render-unrelated` 断言 | 高 | 使用隔离测试工程 |
| 真实页面可加载且控制台无异常 | `http://127.0.0.1:7864/` 浏览器验收和截图 | 高 | 当前工程仅剩旧逻辑处理后可用的 1 个片断 |
