# 最终回执

## 原始目标

解决 Docker 中完整音频渲染首次加载过慢且页面缺少真实加载信息的问题。模型应保存于数据卷，镜像应只发布代码和运行环境，并保持开机启动和成果物挂载。

## 当前验收状态

| 验收项 | 成果物或证据 | 状态 |
|---|---|---|
| 确认慢点范围 | 冷加载约 4 分 50 秒，热加载约 5 秒和 6 秒 | 合格 |
| IndexTTS 独立命名卷 | `compose.yaml` 与 `indextts25-indextts-model` | 进行中 |
| VoiceDesign 独立命名卷 | `indextts25-qwen-voice-design-model` | 合格 |
| 镜像不加入模型权重 | Compose 外部卷挂载 | 代码合格，发布待验收 |
| Render Runtime 页面遥测 | API、类型和页面实现及测试 | 代码合格，浏览器待验收 |
| 1.1.2 镜像包含本轮逻辑 | Docker 构建与 revision | `evidence_missing` |
| 容器健康与开机启动 | healthy、RestartCount、`unless-stopped` | 旧 1.1.1 合格，新 1.1.2 待验收 |
| 真实 GPU 冷启动和热启动 | 作业、耗时、输出 WAV、GPU | `evidence_missing` |
| 浏览器、Console、截图 | 浏览器验收证据 | `evidence_missing` |
| Git 提交 | 白名单提交 | `evidence_missing` |

当前回执属于进行中记录。全部条目合格后才能标记完成和正式发布。
