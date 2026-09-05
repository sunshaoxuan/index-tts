# 证据索引

| 结论 | 证据位置 | 置信度 | 限制 |
|---|---|---|---|
| 三版均传入同一参考 WAV | `tests/test_text_director.py` 的参考音色身份回归测试 | 高 | 单元测试使用可控假模型 |
| 随机情绪原型会侵入高级三版身份稳定性 | `text_director.py` 固定 `use_random=False` 与回归断言 | 高 | 主观音色仍需人工试听 |
| 音色门槛为 0.82 | `text_director.py`、最新渲染 API 与浏览器截图 | 高 | CAMPPlus 是自动代理门禁 |
| 完整门禁成为候选硬条件 | `text_director.py` 的 `quality_passed` 筛选和异常保护 | 高 | 重音为空时不适用重音校验 |
| 旧片断在候选不足时保持 | `tests/test_text_director.py` 的不足三版回归 | 高 | 真实失败耗尽分支未在本轮 GPU 任务中触发 |
| 页面优先展示最新待选三版 | `product-studio/server/index.mjs` 与 `index.test.mjs` | 高 | 同序号和同文本冲突场景由回归测试覆盖 |
| 真实 GPU 三版均通过 0.82 | `D:/workspace/IndexTTS-2.5/runtime-output/product-jobs/76906b0efc8b4d5f8df22dab3ed1cf5f`、最新渲染 API | 高 | 最终听感由使用者决定 |
| 三个候选在浏览器可播放 | `browser-segment-24-three-candidates.png`、Browser Use 播放状态和直接 HTTP 检查 | 高 | 截图无法单独证明声音内容 |
| 浏览器无 Console error | Browser Use `tab.dev.logs({level:'error'})` 返回空数组 | 高 | 只覆盖本次验收会话 |
| 当前容器应用修复 | Docker inspect、`/api/health` | 高 | 运行状态具有时效性 |

## 正式成果物

* `investigation_report.md`
* `commands.md`
* `test_results.md`
* `FINAL_ACCEPTANCE_CHECKLIST.md`
* `FINAL_RECEIPT.md`
* `browser-segment-24-three-candidates.png`
