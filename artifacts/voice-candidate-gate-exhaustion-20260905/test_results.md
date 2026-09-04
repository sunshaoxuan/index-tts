# 测试结果

| 项目 | 结果 |
|---|---|
| 角色音色与角色资产聚焦测试 | 39 passed，1 个第三方弃用警告 |
| Product Studio 测试 | 222 passed |
| Product Studio 生产构建 | 通过，存在既有大包体积告警 |
| Python 非 GPU 完整回归 | 367 passed，22 deselected，30 subtests passed，3 个第三方弃用警告 |

首次完整 Python 回归因本任务临时目录名称过长触发 Windows 260 字符路径限制，3 项失败。使用同一工作树内的短任务目录 `.codex-tmp/v` 单独重跑 3 项均通过，随后从完整回归起点重跑并全部通过。

## 真实运行验收

| 项目 | 结果 |
|---|---|
| Product Studio 容器 | `indextts25-product-studio:1.1.85-7540492`，healthy |
| 健康接口 | `/api/health` 返回 200 与 `status: ok` |
| 第一轮真实 GPU | 刘至诚 3 个，旁白 0 个；分类失败计数进入终态文案 |
| 第二轮真实 GPU | 只处理旁白，从 Seed 78 开始，2 个部分合格候选持久化 |
| 第三轮真实 GPU | 只补缺少的 1 个，Seed 114 首次通过，最终补齐 |
| 浏览器候选列表 | 刘至诚与旁白各显示三个候选、播放控件和采用按钮 |
| 浏览器 Console | 0 条日志 |
| 浏览器截图 | `browser-acceptance.png` 已保存 |

文档更新后的复验结果：角色音色与角色资产聚焦测试 39 passed；Product Studio 222 passed；生产构建通过。首次聚焦命令误写了一个不存在的测试文件，0 项执行；定位真实测试路径后已从聚焦验收起点重新执行并通过。
