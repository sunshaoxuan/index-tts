# Test Results

| 检查 | 结果 | 证据 |
|---|---|---|
| 文本导演及 Worker 定向测试 | PASS | 137 passed；包含《成都粉子》真实 issue、年龄值与 basis 分类、冻结人物表、人物复核进度、旁白性别推断、小任务建议失败兜底和手工性别保护 |
| Python 相关回归 | PASS | 122 passed |
| Product Studio 完整测试 | PASS | 216 passed |
| Product Studio 生产构建 | PASS | 3110 modules transformed |
| Diff whitespace | PASS | `git diff --check` exit 0 |
| 全量非 GPU Python | PASS | 363 passed，22 deselected，30 subtests passed |
| 真实同稿性能 | PASS | 82.967 秒墙钟；17196 输入、5718 输出；6 块、0 fallback、5 角色、5 场景、69 分句、覆盖 100% |
| 生产持久化任务 | PASS | 任务 `f0e52ec0479c40f5bb846391c42bbb8a`；85.194 秒墙钟、84.009 秒模型时间、15887 输入、5658 输出、10 次请求、6 块、0 fallback、2 个人物批次、3 次人物请求、1 次局部修复 |
| 生产数据结果 | PASS | 5 个角色、5 个场景、69 个模型分句；历史边界恢复后持久化 60 条；工程原文覆盖 100% |
| 最终生产持久化任务 | PASS | 任务 `6566f3ff96fa4ba0acd00bfa680ef030`；77.977 秒墙钟、76.828 秒模型时间、13802 输入、5293 输出、9 次请求、6 块、0 fallback、2 个人物请求且均一次通过 |
| 最终旁白结果 | PASS | 文档旁白为 `male`、`current_inference`；角色资产为 `male`、`ai_article_inference`；`gender_suggestion.requests=0`；模型原文覆盖 1579/1579 字符 |
| 浏览器、Console、截图 | PASS | `http://127.0.0.1:7864/` 的角色资产页显示旁白“男性 · AI文章推断”；角色资产 5、分句导演 60；桌面截图已目视检查且 Console 日志数组为空 |
| 生产容器 | PASS | `indextts25-product-studio:1.1.82-31dc7f4` healthy；revision `31dc7f469284d7a90e101d06968edee2c99f28fa`；Ollama `qwen3:14b` 为 8192 context、100% GPU |

生产构建保留既有的大 chunk 告警。

窄视口截图未形成独立证据，当前变更未修改响应式样式；已有 Product Studio 移动布局测试继续通过。桌面生产截图已覆盖实际旁白标签与卡片布局。
