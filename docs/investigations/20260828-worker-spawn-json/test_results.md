# 测试结果

| 检查 | 结果 |
|---|---|
| Product Studio 测试 | 100 passed，0 failed |
| Python 解释器测试 | 3 passed |
| Product Studio 生产构建 | 成功，3099 modules transformed |
| Docker 轻量修复镜像 | 成功，依赖基础层复用，构建上下文约 7.91 MB |
| 主虚拟环境 | `/app/.venv`，IndexTTS 包可导入 |
| VoiceDesign 环境 | `/opt/voice-venv`，`qwen_tts` 包可定位 |
| SoX | 14.4.2 |
| 容器 | healthy，RestartCount 0 |
| 真实 API 音色任务 | complete |
| 浏览器音色任务 | complete |
| 浏览器 Console | 0 warning，0 error |
| 浏览器截图 | 通过 |

Vite 仍报告约 1.13 MB bundle 大小 warning，不影响本次构建和运行。
