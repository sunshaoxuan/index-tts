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

首次运行验收使用镜像 `indextts25-product-studio:1.1.91-cd08b48`，镜像 revision 为 `cd08b48ed309feda2392eccc04aa586cb290d014`。容器状态 `running`、健康状态 `healthy`、重启次数 0，`/api/health` 返回 `ok`。

浏览器在 `http://127.0.0.1:7864/` 显示版本 `v1.1.5` 和工程 `成都粉子02`。点击“AI 重新分析全文”后立即显示模型队列状态并锁定工程，任务 `950aad8e35d842f1b384882d0408264e` 从创建到完成约 147 秒。页面终态显示“AI 文本导演完成，恢复历史分句 37 条”，角色 6 条、分句 37 条；Console 错误和警告均为 0，并完成终态截图检查。

真实任务经过全文注册、4 个文本块和 2 个人物复核，共完成 8 次 `/api/chat`，全部返回 200。Ollama 从任务开始前到结束始终使用 PID 1053、`-c 16384` 的同一 runner；验收窗口内 `starting llama-server` 0 次、HTTP 499 为 0、`aborting load` 或 `context canceled` 为 0。任务完成后 `/api/active-job` 返回 `available=false`。
