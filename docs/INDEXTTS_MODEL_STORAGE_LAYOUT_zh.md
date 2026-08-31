# IndexTTS 模型存储布局

## 目标

模型权重和冷启动阶段频繁读取的 PyTorch CUDA 运行依赖统一放在 C 盘 SSD，通过只读语义的宿主机目录向容器提供。项目输出、运行记录、交付物和其他业务数据继续放在 D 盘。

## 正式路径

| 内容 | 宿主机路径 | 容器路径 |
| --- | --- | --- |
| 全部模型权重 | `C:\workspace\IndexTTS-2.5\models\checkpoints` | `/app/checkpoints` |
| PyTorch 主包 | `C:\workspace\IndexTTS-2.5\runtime-packages\torch` | `/app/.venv/lib/python3.11/site-packages/torch` |
| NVIDIA CUDA Python 运行库 | `C:\workspace\IndexTTS-2.5\runtime-packages\nvidia` | `/app/.venv/lib/python3.11/site-packages/nvidia` |
| Triton 运行库 | `C:\workspace\IndexTTS-2.5\runtime-packages\triton` | `/app/.venv/lib/python3.11/site-packages/triton` |
| 生成输出 | `D:\workspace\IndexTTS-2.5\outputs` | `/app/outputs` |
| 运行记录 | `D:\workspace\IndexTTS-2.5\runtime-output` | `/app/runtime-output` |
| 交付物 | `D:\workspace\IndexTTS-2.5\artifacts` | `/app/artifacts` |

`Qwen3-TTS-12Hz-1.7B-VoiceDesign` 包含在 C 盘的统一模型目录中。现行服务不再为该子目录叠加 Docker 命名卷。

PyTorch、NVIDIA CUDA Python 运行库和 Triton 原本位于 Docker overlay 镜像层。Docker Desktop 数据盘位于 D 盘时，首次导入 PyTorch 会读取 D 盘 VHDX。现行 Compose 将这三个依赖目录从 C 盘 SSD 只读挂载到原包路径，其他镜像层、Docker 数据卷和业务数据仍保留在 D 盘。

运行依赖目录应从当前正式镜像的相同 Python 3.11 环境复制。升级 PyTorch、CUDA、Triton、Python 版本或基础镜像后，必须重新生成该目录，并重新核对文件数量、总字节数、关键共享库 SHA256 和真实 CUDA 导入。

## 迁移验收

迁移前后应逐项检查模型文件数量、总字节数、关键权重 SHA256、运行依赖文件数量、关键共享库 SHA256、Compose 展开配置、容器实际挂载、只读标记、健康状态、GPU 可用性、真实冷启动任务和浏览器页面。

容器实际挂载中的 `/app/checkpoints` 和三个 Python 运行依赖目录来源必须为 C 盘正式路径。三个运行依赖挂载必须为只读。输出、运行记录和交付物的来源必须保持为 D 盘正式路径。

Windows 工作树可能使用 CRLF 行尾。增量镜像构建会在统一去除 CR 字节后比较 `package.json` 和 `pnpm-lock.yaml`，并统一规范化应用入口和后端目录中的 shell 脚本。依赖内容发生变化时构建仍会停止，单纯行尾变化不会阻断构建和容器启动。

## 回滚保留

旧目录 `D:\workspace\IndexTTS-2.5\checkpoints`、旧命名卷 `indextts25-qwen-voice-design-model` 和镜像内原始 Python 包作为回滚来源保留。迁移最终验收通过后仍继续保留。后续删除需要单独确认，并在删除前再次执行文件和运行状态检查。

回滚运行依赖时应等待活动任务结束，从 Compose 删除三个 `runtime-packages` 挂载，使用保留镜像重建容器，并重新执行健康检查、CUDA 导入、模型加载和浏览器验收。回滚模型权重时恢复旧模型挂载，并执行同一组运行验收。
