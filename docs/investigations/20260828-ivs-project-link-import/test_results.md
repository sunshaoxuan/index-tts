# Test Results

| 检查 | 结果 |
|---|---|
| Product Studio 测试 | 102 passed，0 failed |
| Python 项目与角色资产测试 | 15 passed |
| TypeScript 与 Vite 生产构建 | passed，3100 modules transformed |
| Diff whitespace check | passed |
| 真实 16 MB 工程关联导入 | passed，116 ms，8 roles，22 available voices，0 missing |
| 真实纠音导入 | passed，4 pronunciations，导演记忆一致，重新读取一致 |
| 浏览器 DOM | passed，新建纠音说明、成功提示、角色资产 8、全篇纠音 4 可见 |
| 浏览器 Console | passed，产品错误与警告为 0 |
| 7864 Docker 运行态 | passed，容器 healthy，生产 bundle 与项目列表接口包含本功能契约 |
| 浏览器截图 | passed，`artifacts/ivs-project-link-import/pronunciation-import-browser-final.png` |

生产构建保留一个既有提示：压缩前主 JavaScript chunk 大于 1100 kB。
