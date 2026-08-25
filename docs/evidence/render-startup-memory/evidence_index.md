# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 旧任务卡在 PyTorch CUDA 导入 | PID 35800 模块列表停在 `cublas64_12.dll`，状态文件保持 queued | 高 | 进程已结束 |
| 主机内存耗尽是直接阻塞条件 | 可用内存约 285 MiB，停止 daemon 后模块继续加载，清理 WSL 缓存后可用内存约 15 GiB | 高 | 性能计数器是运行时快照 |
| Docker 数据未被删除 | 清理前后 5 个运行容器保持运行，5 个镜像和 21 个卷未执行删除 | 高 | 容器状态会随时间变化 |
| 新 Worker 在导入前写状态 | `product_render_worker.py` 与 `tests/test_product_render_worker.py` | 高 | 单元测试与真实任务均覆盖 |
| daemon 释放协议有请求匹配 | `voice_design_daemon.py`、`voice_design_daemon_client.py`、`tests/test_voice_design_daemon.py` | 高 | 真实大模型释放分支本轮未重载验证 |
| 完整渲染成功 | `runtime-output/product-jobs/801de0037c2c4188873e7fc86ca166e2` | 高 | 运行输出不纳入 Git |
| 交付包完整 | ZIP 144 个条目且 CRC 测试通过，WAV 793.344 秒，HTTP audio/package 均为 200 | 高 | 音频听感未逐句人工审听 |
| 浏览器运行态通过 | 真实页面 2% loading、3% 4/102、完成态 13:13 播放器，Console 0 错误和警告 | 高 | 截图保存在本任务视觉证据中 |
