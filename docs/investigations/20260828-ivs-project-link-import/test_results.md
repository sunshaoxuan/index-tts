# Test Results

| 检查 | 结果 |
|---|---|
| Product Studio 测试 | 100 passed，0 failed |
| Python 项目与角色资产测试 | 15 passed |
| TypeScript 与 Vite 生产构建 | passed，3099 modules transformed |
| Diff whitespace check | passed |
| 真实 16 MB 工程关联导入 | passed，116 ms，8 roles，22 available voices，0 missing |
| 浏览器 DOM | passed，新建多选字段与角色资产 8 可见 |
| 浏览器 Console | passed，产品错误与警告为 0 |
| 浏览器截图 | `evidence_missing`，连续两次超时 |

生产构建保留一个既有提示：压缩前主 JavaScript chunk 大于 1100 kB。
