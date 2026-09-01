# Index Voice Studio Docker 部署说明

## 部署目标

Docker 镜像包含 Product Studio、Node.js 24、两套 Python 3.11 推理环境、FFmpeg 和应用源码。模型、用户工程、运行配置与成果物独立于镜像层持久化。

| 持久化来源 | 容器目录 | 内容 |
|---|---|---|
| 外部卷 `indextts25-models-ssd`，实际目录 `C:\workspace\IndexTTS-2.5\models\checkpoints` | `/app/checkpoints` | IndexTTS 2.5 与 VoiceDesign 模型，位于 NVMe SSD 并以只读方式挂载 |
| `outputs` | `/app/outputs` | 小说工程、永久音色、渲染版本与分轨包 |
| `runtime-output` | `/app/runtime-output` | 全局 AI 配置、API Key、任务状态与日志 |
| `artifacts` | `/app/artifacts` | 字幕、样本发布包和其他正式成果物 |

这些目录和数据卷不会进入镜像层。删除或替换容器不会删除其中的内容。首次部署需把完整模型目录复制到目标机器的 SSD，并创建指向该目录的外部 Docker 卷。迁移时应同时传输镜像、模型目录、`outputs`、`runtime-output` 和 `artifacts`。

首次启动或恢复备份前创建模型卷：

```powershell
docker volume create --driver local --opt type=none --opt o=bind --opt device=/run/desktop/mnt/host/c/workspace/IndexTTS-2.5/models/checkpoints indextts25-models-ssd
```

## 本机启动

在项目根目录执行：

```powershell
docker compose up -d --build
```

启动完成后访问 `http://127.0.0.1:7864/`。容器通过 `host.docker.internal:11434` 访问宿主机 Ollama。Compose 为容器申请一张 NVIDIA GPU，并使用 `unless-stopped` 重启策略。

## 状态检查

```powershell
docker compose ps
```

健康状态应为 `healthy`。应用健康接口为 `http://127.0.0.1:7864/api/health`。

## 开机启动条件

容器已经配置 `restart: unless-stopped`。Docker Desktop 还必须启用登录时自动启动。两项同时满足后，Windows 登录并启动 Docker Engine 时，容器会自动恢复。

## 迁移

导出镜像：

```powershell
docker save --output indextts25-product-studio-1.1.0.tar indextts25-product-studio:1.1.0
```

将镜像文件、`compose.yaml`、SSD 模型目录、`outputs`、`runtime-output` 和 `artifacts` 复制到目标机器。目标机器加载镜像、创建指向 SSD 模型目录的外部卷后启动：

```powershell
docker load --input indextts25-product-studio-1.1.0.tar
docker compose up -d --no-build
```

目标机器需要兼容的 NVIDIA 显卡驱动、WSL 2、Docker Desktop Linux 容器后端和 NVIDIA GPU 支持。复制 `runtime-output` 会一并复制已保存的 API Key，样本发布前应确认目标机器的访问控制和密钥保管要求。

## 停止与恢复

停止容器：

```powershell
docker compose stop
```

`unless-stopped` 会保留人工停止状态。恢复开机自动运行前执行：

```powershell
docker compose start
```
