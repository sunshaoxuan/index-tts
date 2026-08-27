# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 页面卡在 5% 时后台持续加载权重 | 实际加载期间容器 Block I/O 与 RSS 持续增长；服务端遥测读取 `/proc/<pid>/io` 和 `/proc/<pid>/status` | 高 | 历史数值来自当次运行日志 |
| 前端已展示辅助遥测 | `product-studio/src/App.tsx`、`product-studio/src/api.ts`、`product-studio/src/styles.css` | 高 | 完成状态下不会继续显示进度浮层 |
| 服务端已采集 Worker 与 VoiceDesign Runtime 状态 | `product-studio/server/index.mjs` | 高 | Linux 容器之外缺少 `/proc` 时字段可为空 |
| 开始时间使用输入文件写入时间 | `product-studio/server/index.mjs:1189`、`product-studio/server/index.test.mjs:880` | 高 | 依赖输入文件成功写入 |
| 专用解释器入口不再解析到系统 Python | `runtime_python.py`、`tests/test_runtime_python.py` | 高 | 当前测试覆盖 POSIX 虚拟环境符号链接 |
| 真实音色作业完成 | `runtime-output/product-jobs/d97f4d474aca45d1aadaa9aacb62ba7d/status.json`、`result.json` | 高 | 仅对应本次实际作业 |
| 口音进入模型指令和最终元数据 | `outputs/voice-library/voice-0c81cc4a13b887b9.json` | 高 | 听感达成度需要人工试听 |
| 容器健康且可开机恢复 | `docker compose ps`、`compose.yaml` 中 `restart: unless-stopped` | 高 | Docker Desktop 与 WSL 自身需随 Windows 启动 |
| VoiceDesign 权重位于数据卷 | `compose.yaml` 中外部卷 `indextts25-qwen-voice-design-model` | 高 | 迁移时需要单独备份和恢复该卷 |
| 当前页面无 Console warning 或 error | 2026-08-27 Codex In-app Browser 验收，URL `http://localhost:7864/` | 高 | 当前截图为作业完成后的工程页面 |
