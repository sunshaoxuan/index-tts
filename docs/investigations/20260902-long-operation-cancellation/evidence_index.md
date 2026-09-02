# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 后台等待和运行任务可取消 | `product-studio/server/index.mjs` 的 `cancelJob` 与 `DELETE /api/jobs/:id`，完整 Node 测试 | 高 | 浏览器使用模拟 Worker |
| 只终止属于当前音频任务的 Runtime | `terminateOwnedRuntime`，测试 `terminates only the runtime request owned by the cancelled audio job` | 高 | 本轮未终止生产 Runtime |
| 取消依赖会阻止后续任务 | `model-job-scheduler.mjs` 与 cancelled dependency 测试 | 高 | 无 |
| 同步 AI 与图片可中止上游请求 | `requestAbortSignal`、API `signal` 参数、隔离模拟服务中止记录 | 高 | 上游为隔离模拟服务 |
| 所有可见取消按钮存在 | `longOperationCancellationUI.test.ts`，浏览器 DOM 检查 | 高 | 无 |
| 全量图片取消保留已完成成果 | `storyboardKeyframeBatch.test.ts`，浏览器在 `1 / 2` 时取消并只保留“窗边观察关键帧” | 高 | 图片内容由模拟服务生成 |
| 移动端取消按钮可见且无水平溢出 | `screenshots/mobile-batch-image-cancel.png`，浏览器度量 `scrollWidth - clientWidth = 0` | 高 | 视口为 390 x 844 |
| Console 无错误和警告 | 干净标签页最终 `tab.dev.logs` 返回空数组 | 高 | 隔离运行环境 |

## 截图

* `screenshots/desktop-background-job-cancel.png`
* `screenshots/desktop-single-image-cancel.png`
* `screenshots/desktop-character-ai-cancel.png`
* `screenshots/desktop-batch-image-cancel.png`
* `screenshots/mobile-batch-image-cancel.png`
