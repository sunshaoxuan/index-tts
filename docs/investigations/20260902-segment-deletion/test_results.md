# 测试结果

| 检查 | 结果 | 证据摘要 |
|---|---|---|
| 聚焦 Node 测试 | PASS | 77 tests, 77 pass |
| 完整 Product Studio 测试 | PASS | 170 tests, 170 pass |
| TypeScript 与 Vite 正式构建 | PASS | 3108 modules transformed |
| 服务端删除失效回归 | PASS | 仅被删缓存键失效，后续缓存存在，片断迁移到序号 2 |
| 桌面浏览器 | PASS | 选择 1 条后删除按钮启用，确认层数量与影响说明正确 |
| 保存与刷新 | PASS | 3 条变 2 条，序号 1、2，注释分句不再出现，原稿仍含注释 |
| 390×844 浏览器 | PASS | `scrollWidth=375`，`innerWidth=390`，确认层和工具栏可操作 |
| Console | PASS | error 0, warning 0 |
| 测试工程清理 | PASS | `testProjectRemaining=0` |
| 现有 7864 容器 | PASS | status `ok`，Docker healthy |

构建有既有的大 chunk 警告，产物生成成功。本次没有增加新的构建错误。
