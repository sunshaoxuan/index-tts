# 完整音频渲染长期 0% 调查报告

## 现象

任务 `83878436977542098a8f50b2ac832e08` 从 2026 年 8 月 25 日 23:05:50 起持续保持 `queued`、0% 和“任务已进入队列”。任务目录只有 `input.json` 与 `status.json`，没有 `result.json` 或 `worker.log`。

## 根因证据

实际解释器 PID 35800 已经运行，但累计 CPU 约 4 秒，Working Set 约 16 MiB。加载模块停在 PyTorch CUDA 的 `cublas64_12.dll`，三个线程都处于等待状态。主机可用内存最低约 285 MiB，分页和 D 盘忙碌度持续偏高。`product_render_worker.py` 当时在模块顶层导入 PyTorch，进入 `main()` 后才写 `loading`，因此页面无法区分队列等待和 CUDA 库导入阻塞。

VoiceDesign daemon PID 23772 的 Private Memory 约 10 GiB。Docker Desktop 的 WSL 实例提交量约 34 GiB，其中 Linux 内部约 29.9 GiB 是文件缓存。停止 VoiceDesign daemon 后，旧 Worker 从 `cublas` 继续加载到 cuDNN；清理 WSL 文件缓存后，Windows 可用内存最终恢复到约 15 GiB。该行为链确认直接阻塞条件是主机内存耗尽造成的严重换页。

## 修复

1. `product_render_worker.py` 把 PyTorch、IndexTTS 与渲染依赖改为延迟导入。
2. Worker 在重量级导入前写入 `preparing`，请求 VoiceDesign daemon 释放模型与 CUDA 缓存。
3. daemon 使用带 request ID 的请求与响应文件确认释放结果，保留进程供后续音色任务按需重新加载。
4. 释放后检查主机可用物理内存。低于 2 GiB 时写入明确错误终态，不再无限等待。
5. Worker 在加载 CUDA 运行库前写入 `importing`，模型构造阶段继续使用既有 `loading`。

## 真实运行

修复后任务 `801de0037c2c4188873e7fc86ca166e2` 依次显示 `importing`、`loading`、`rendering` 和 `complete`。任务生成 102 条分句、33 个章节音频、6 个有内容的角色轨道和 13 分 13 秒完整音频，复用 22 条工程缓存。浏览器显示从 2% 模型加载到 3% 分句渲染，完成后交付页可以播放到 0:02，Console 没有错误或警告。

## 限制

真实任务启动时 VoiceDesign daemon 已通过既有停止协议退出，因此新释放协议的真实大模型释放分支由单元测试覆盖，未在本次运行中重新加载约 10 GiB VoiceDesign 模型后重复验证。
