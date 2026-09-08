# 测试与验收结果

## 代码回归

| 检查 | 结果 |
|---|---|
| `python -m py_compile text_director.py product_analysis_worker.py` | 通过 |
| Python 聚焦测试 | 125 passed |
| Python 完整非 GPU 回归 | 372 passed、22 deselected、30 subtests passed；3 项第三方弃用警告 |
| Product Studio 聚焦队列与服务端测试 | 75 passed |
| Product Studio 完整测试 | 229 passed |
| TypeScript 与 Vite 生产构建 | 通过，3110 modules transformed；仅有既存大 chunk 提示 |
| `git diff --check` | 通过 |

## 运行验收

镜像 revision、容器、浏览器、Console、截图与真实 Ollama runner 稳定性在部署后填写。
