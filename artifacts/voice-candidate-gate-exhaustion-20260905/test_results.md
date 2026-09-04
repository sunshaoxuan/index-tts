# 测试结果

| 项目 | 结果 |
|---|---|
| 角色音色与角色资产聚焦测试 | 39 passed，1 个第三方弃用警告 |
| Product Studio 测试 | 222 passed |
| Product Studio 生产构建 | 通过，存在既有大包体积告警 |
| Python 非 GPU 完整回归 | 367 passed，22 deselected，30 subtests passed，3 个第三方弃用警告 |

首次完整 Python 回归因本任务临时目录名称过长触发 Windows 260 字符路径限制，3 项失败。使用同一工作树内的短任务目录 `.codex-tmp/v` 单独重跑 3 项均通过，随后从完整回归起点重跑并全部通过。

真实 GPU、容器和浏览器结果将在执行后追加。
