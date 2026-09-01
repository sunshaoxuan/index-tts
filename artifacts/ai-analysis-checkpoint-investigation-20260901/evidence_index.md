# Evidence Index

| Claim | Evidence | Confidence | Limitation |
|---|---|---|---|
| 截图对应项目与 Job 已定位 | `outputs/novel-projects/20260901093206-景甜-张继科-性工作者的爱情-477ea8/project.json`; `runtime-output/product-jobs/6ad5682f2f3c46fe9b9243d85a7d5d43/input.json` | high | 仅对应本次截图任务 |
| 任务约运行 2 小时 8 分钟 | input 文件时间 18:33:34；status 与 worker.log 时间 20:41:55 | high | status 只保留最终时点 |
| Ollama 执行了 26 次 chat，其中 3 次 600 秒失败 | `docker logs ollama` 的指定时间窗 | high | Ollama 日志没有 Job ID；该窗口内最新产品 Job 只有本任务 |
| 最终失败位于人物校验第 1 轮内部修复 | `worker.log` traceback；运行容器 `/app/text_director.py` 的 `validate_character_analysis` | high | 模型原始响应未落盘 |
| 校验器会跨字段误判 | 运行容器内直接调用 `_character_validation_inconsistencies` 的复现输出 | high | 复现是最小输入，不是原始响应 |
| 本次没有可恢复中间产物 | Job 目录仅有 input、status、worker.log；项目 analysis 目录为空 | high | Worker 内存已经随进程退出释放 |
| Worker 只在全部后处理完成后保存 | 运行容器 `/app/product_analysis_worker.py` 的 `store.save` 与 `result.json` 写入顺序 | high | 容器镜像 revision 为 `2c7e7d9`，工作树 HEAD 不同 |
| 当前 API 只会创建新分析任务 | `product-studio/server/index.mjs` 的 `/api/projects/:id/analyze` 与 `startJob` | high | 当前源码工作树与运行镜像存在版本差异，路由结构一致 |
