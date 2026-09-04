# Test Results

| 检查 | 结果 | 证据 |
|---|---|---|
| 文本导演及 Worker 定向测试 | PASS | 126 passed；包含《成都粉子》真实 issue、编号紧凑协议、冻结人物表、人物复核进度单调、失败小批次隔离重做、旁白性别推断、小任务建议失败兜底和手工性别保护 |
| Python 相关回归 | PASS | 122 passed |
| Product Studio 完整测试 | PASS | 216 passed |
| Product Studio 生产构建 | PASS | 3110 modules transformed |
| Diff whitespace | PASS | `git diff --check` exit 0 |
| 全量非 GPU Python | PASS | 362 passed，22 deselected，30 subtests passed |
| 真实同稿性能 | PASS | 82.967 秒墙钟；17196 输入、5718 输出；6 块、0 fallback、5 角色、5 场景、69 分句、覆盖 100% |
| 生产持久化任务 | PASS | 任务 `f0e52ec0479c40f5bb846391c42bbb8a`；85.194 秒墙钟、84.009 秒模型时间、15887 输入、5658 输出、10 次请求、6 块、0 fallback、2 个人物批次、3 次人物请求、1 次局部修复 |
| 生产数据结果 | PASS | 5 个角色、5 个场景、69 个模型分句；历史边界恢复后持久化 60 条；工程原文覆盖 100% |
| 浏览器、Console、截图 | PASS | `http://127.0.0.1:7864/` 显示完成状态、角色资产 5、分句导演 60；角色页与分句页截图已目视检查；Console 日志数组为空 |
| 生产容器 | PASS | `indextts25-product-studio:1.1.80-1353715` healthy；revision `13537153c4d8eb2c37e94958bacc7e4fcdab98b6`；Ollama `qwen3:14b` 为 8192 context、100% GPU |

生产构建保留既有的大 chunk 告警。

旁白性别修复的生产部署、同稿重新分析、角色卡片、Console 与截图证据在新镜像验收后补充。
