# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 原页面错误来自 Windows `os.kill(pid, 0)` | `runtime-output/product-jobs/4bdafe6e613b478fa0c51d01d499e3c7/worker.log` | 高 | 运行输出不纳入 Git |
| 失效 PID 能被识别 | 聚焦测试与最小检查中 invalid 为 false | 高 | 无 |
| 当前进程能被识别 | 聚焦测试与最小检查中 current 为 true | 高 | 无 |
| 包装 PID 与 runtime PID 可以不同 | 冷启动时包装 PID 33624，runtime PID 23772 | 高 | PID 会随运行变化 |
| 实际音色生成完成 | `runtime-output/product-jobs/df4e88f2bfa44f09a47d2402f1f9ebf6/status.json` 与 `result.json` | 高 | 运行输出不纳入 Git |
| 模型保持驻留 | `runtime-output/voice-design-runtime/state.json` | 高 | 进程停止后状态会变化 |
| 页面与控制台通过 | 浏览器 DOM、Console 0 error、0 warning、截图检查 | 高 | 截图保存在本次浏览器验收记录中 |
| 后续 VoiceDesign 复用同一模型 | 连续四个任务均为 PID 23772 与 `model_reused: true` | 高 | PID 会随服务重启变化 |
| 无变更任务不再调用第二个模型 | 任务 `60ace1d6fe0645ce87be9016b05f857a`，Ollama 前后活动模型数为 0 | 高 | 仅对输入签名完全一致的任务复用 |
