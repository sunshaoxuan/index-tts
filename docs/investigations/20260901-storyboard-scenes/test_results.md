# 测试结果

## 自动化测试

| 检查 | 结果 |
|---|---|
| Python 应用回归 | 304 passed，30 subtests passed |
| 分镜与 Render Daemon 聚焦测试 | 81 passed |
| Product Studio Node 测试 | 156 passed |
| Product Studio 生产构建 | 3107 modules transformed |
| `docker compose config --quiet` | 通过 |
| `git diff --check` | 通过 |

Python 应用回归使用 `--ignore=tests/test_v1.py --ignore=tests/test_v2.py`。当前 checkpoint 配置与 v1、v2 推理 fixture 不匹配，包含这两个文件的先前全量运行产生 16 个 fixture 初始化错误。

## Docker 与 API

| 检查 | 结果 |
|---|---|
| 镜像 | `indextts25-product-studio:1.1.57-a44e59d` |
| 镜像 revision | `a44e59dc45c927ad3f1f229098d1cdb46341cd85` |
| 容器健康 | healthy，Restart Count 0 |
| `/api/health` | ok |
| 首页、JS、CSS | HTTP 200，媒体类型正确 |
| IndexTTS 模型卷 | `indextts25-indextts-model`，`config.yaml` 存在 |
| VoiceDesign 模型卷 | `indextts25-qwen-voice-design-model`，权重与 tokenizer 文件存在 |

## 浏览器

| 检查 | 结果 |
|---|---|
| 隔离桌面场景卡片 | 通过，两张卡片、两个音频范围、16 比 9 关键帧、单张与全量按钮 |
| 隔离移动 390×844 | 通过，标题完整，无横向溢出 |
| 生产桌面 1280×720 | 通过，视频分镜页可见，无横向溢出，Console 日志为空 |
| 生产移动 390×844 | 通过，标题、风格和按钮完整，无横向溢出，Console 日志为空 |
