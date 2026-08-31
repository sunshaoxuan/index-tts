# IndexTTS 模型存储布局

## 目标

模型权重统一放在 C 盘 SSD，通过单一只读语义的宿主机目录向容器提供。项目输出、运行记录、交付物和其他业务数据继续放在 D 盘。

## 正式路径

| 内容 | 宿主机路径 | 容器路径 |
| --- | --- | --- |
| 全部模型权重 | `C:\workspace\IndexTTS-2.5\models\checkpoints` | `/app/checkpoints` |
| 生成输出 | `D:\workspace\IndexTTS-2.5\outputs` | `/app/outputs` |
| 运行记录 | `D:\workspace\IndexTTS-2.5\runtime-output` | `/app/runtime-output` |
| 交付物 | `D:\workspace\IndexTTS-2.5\artifacts` | `/app/artifacts` |

`Qwen3-TTS-12Hz-1.7B-VoiceDesign` 包含在 C 盘的统一模型目录中。现行服务不再为该子目录叠加 Docker 命名卷。

## 迁移验收

迁移前后应逐项检查模型文件数量、总字节数、关键权重 SHA256、Compose 展开配置、容器实际挂载、健康状态、GPU 可用性、真实冷启动任务和浏览器页面。

容器实际挂载中的 `/app/checkpoints` 来源必须为 C 盘正式路径。输出、运行记录和交付物的来源必须保持为 D 盘正式路径。

Windows 工作树可能使用 CRLF 行尾。增量镜像构建会在统一去除 CR 字节后比较 `package.json` 和 `pnpm-lock.yaml`，并统一规范化应用入口和后端目录中的 shell 脚本。依赖内容发生变化时构建仍会停止，单纯行尾变化不会阻断构建和容器启动。

## 回滚保留

旧目录 `D:\workspace\IndexTTS-2.5\checkpoints` 和旧命名卷 `indextts25-qwen-voice-design-model` 作为回滚副本保留。迁移最终验收通过后仍继续保留。后续删除需要单独确认，并在删除前再次执行文件和运行状态检查。

回滚时应停止新任务进入，恢复旧模型挂载，重建容器，并重新执行健康检查、模型加载和浏览器验收。
