# Docker 模型 SSD 挂载回退调查

## 调查问题

完整渲染在页面运行 8 分 20 秒时仍显示 IndexTTS 模型加载中，累计读取 6.13 GB / 10.86 GB。使用者此前要求模型位于 SSD，需要确认当前物理读取介质、配置回退原因和修复效果。

## 根因

本机 C 盘位于 `PS5027-E27T-1T V7` NVMe SSD，D 盘位于 `WDC WD40EZAX-00C8UB0` SATA HDD。Docker Desktop 的统一 Linux 数据盘配置为 `D:\DockerDesktopWSL\disk\docker_data.vhdx`，所以普通 Docker 命名卷位于 D 盘 HDD。

提交 `6989cdd` 曾把 `/app/checkpoints` 切换到 `C:\workspace\IndexTTS-2.5\models\checkpoints`。提交 `a44e59d` 在增加模型加载遥测时，把该挂载改回 `indextts25-indextts-model` 与 `indextts25-qwen-voice-design-model` 两个普通命名卷。遥测功能没有改变存储介质的需求，该挂载变化属于配置回退。

## 修复

创建外部卷 `indextts25-models-ssd`，本地驱动的 bind 设备为 `/run/desktop/mnt/host/c/workspace/IndexTTS-2.5/models/checkpoints`。Compose 将该卷以只读方式挂载到 `/app/checkpoints`。IndexTTS 与 VoiceDesign 使用同一 SSD 模型目录，旧 HDD 模型卷继续保留为回滚来源。

## 实测结果

| 路径 | 作业 | 首次冷启动 | 结果 |
|---|---|---:|---|
| D 盘 Docker VHDX 普通命名卷 | `79556c1c45bc4854abf77d88542ece23` | 约 6 分 21 秒 | `model_reused=false`，完成 |
| C 盘 NVMe SSD 外部卷 | `d26a101ffd4e450b979846b0b2c4d328` | 163.3 秒，约 2 分 43 秒 | `model_reused=false`，完成 |
| SSD 驻留模型热路径 | `28526afe40724a0194cf7e1076e0d44b` | 7.823 秒 | `model_reused=true`，完成 |

SSD 冷启动比本轮 HDD 冷启动缩短约 57%，速度约为 2.33 倍。SSD 加载阶段 C 盘实测读取约 120 到 186 MB/s。剩余时间包含 Python 依赖导入、模型解析、CPU 内存初始化和 GPU 装载。

## 证据边界

系统级 D 盘计数还包含同机 PostgreSQL、Ollama、Docker 镜像层与其他容器活动。模型来源以容器挂载、外部卷设备路径、只读标记、文件清单、哈希和作业耗时为主要证据。
