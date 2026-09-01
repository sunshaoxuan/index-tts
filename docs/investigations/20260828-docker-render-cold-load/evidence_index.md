# 证据索引

| 编号 | 证据 | 用途 |
|---|---|---|
| E01 | Product Studio 作业 `02377f22cc504c8b851dab14172f654f` 状态与时间戳 | 首次冷加载耗时 |
| E02 | Product Studio 作业 `58532eb0d1c242d3b1465108d5ba4243` 和 `f34fdb55da7f42e5b01bc3eb0961adcd` | 驻留模型复用耗时 |
| E03 | 宿主 `checkpoints` 清单，排除 `Qwen3-TTS-12Hz-1.7B-VoiceDesign` | IndexTTS 模型文件数与字节数 |
| E04 | `docker top 503a8ee3bf42` | 模型卷复制进程与磁盘等待状态 |
| E05 | `docker exec 503a8ee3bf42 ... du -sb /target` | 命名卷复制实时进度 |
| E06 | `compose.yaml` | IndexTTS 与 VoiceDesign 独立命名卷挂载 |
| E07 | `render_daemon.py` | Render Runtime 模型总字节遥测 |
| E08 | `product-studio/server/index.mjs` | 作业 API 的 Render Runtime 遥测 |
| E09 | `product-studio/src/App.tsx` | 页面加载状态、内存和读取量展示 |
| E10 | 自动化测试输出 | API 与 Python 遥测回归验证 |

新容器的真实冷启动时间、热启动时间、浏览器截图和 Console 结果将在发布验收后补充。
