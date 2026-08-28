# Evidence Index

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 新建窗口可多选来源工程 | 内置浏览器 DOM，字段“关联已有工程并导入角色、音色与纠音”，来源显示 8 个角色 | high | 单个真实来源工程 |
| 全部候选音色进入新工程 | 真实运行结果：22 个音色 ID，22 个可用 WAV，0 个缺失 | high | 单个真实来源工程 |
| 多来源角色 ID 不会覆盖 | `product-studio/server/index.test.mjs` 双来源 `narrator` 冲突用例 | high | fixture 执行 |
| 多来源纠音去重并保留冲突回执 | `product-studio/server/index.test.mjs` 包含完全重复、内容冲突及首来源优先断言 | high | fixture 执行 |
| 来源纠音写入当前工程与导演记忆 | 真实来源导入 4 条，重新读取与导演记忆一致 | high | 单个真实来源工程 |
| 大型历史不进入导入规范化 | 真实 16 MB 快照导入 116 ms；测试包含历史数组 | high | 性能受主机负载影响 |
| UI Console 无产品错误 | 内置浏览器 `tab.dev.logs` 返回空列表 | high | Statsig 浏览器宿主提示不属于产品页面 Console |
| UI 截图 | `artifacts/ivs-project-link-import/pronunciation-import-browser-final.png` | high | 当前桌面视口 |
