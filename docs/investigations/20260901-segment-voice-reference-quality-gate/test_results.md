# 测试结果

| 测试 | 结果 | 状态 |
|---|---:|---|
| `tests/test_text_director.py` | 74 passed | 通过 |
| Product Studio 全量 Node 测试 | 152 passed | 通过 |
| Vite 生产构建 | 3106 modules transformed | 通过，存在既有大 chunk 警告 |
| Docker 镜像与容器 | 待执行 | pending |
| 浏览器 DOM、Console、截图 | 待执行 | pending |
| 第 165 条真实重新生成 | 待执行 | pending |

首次容器浏览器检查发现历史候选仍沿用旧 `quality_passed`，造成基础音频和音色证据缺失时显示综合通过。实现已改为缺少新证据时关闭门禁，并新增服务端回归测试。全部最终验收需要从起点重新执行。

返工后第一次 Vite 命令从仓库根目录运行，因入口目录错误报告 `Cannot resolve entry module index.html`。随后从 `product-studio` 目录执行相同生产构建，3106 个模块完成转换并通过。
