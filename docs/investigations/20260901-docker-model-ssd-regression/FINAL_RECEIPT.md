# 最终回执

## 初衷级验收清单

| 原始要求 | 成果物与证据 | 状态 |
|---|---|---|
| 模型位于 SSD | `indextts25-models-ssd` 指向 C 盘 NVMe 正式目录 | 合格 |
| 保留 Docker 数据卷接口 | Compose 外部 volume `indextts25-models-ssd` | 合格 |
| 模型不进入镜像 | `/app/checkpoints` 外部只读挂载 | 合格 |
| IndexTTS 与 VoiceDesign 都位于 SSD | 统一目录 113 个文件，16,176,505,324 字节 | 合格 |
| 不丢失或损坏权重 | 文件数、字节数、五项核心 SHA256 一致 | 合格 |
| 保留原卷回滚 | 两个旧 HDD 命名卷未删除 | 合格 |
| 容器继续使用当前应用镜像 | `1.1.59-storyboard-working` | 合格 |
| 容器健康并自动恢复 | healthy，RestartCount 0，`unless-stopped` | 合格 |
| 真实 GPU 冷启动改善 | 6 分 21 秒缩短到 163.3 秒 | 合格 |
| 模型驻留复用 | 7.823 秒，`model_reused=true` | 合格 |
| UI、Console、截图 | 页面正常，Console 0 warning / 0 error，截图通过 | 合格 |
| 配置和需求文档一致 | Compose、部署说明、存储布局、需求、README、CHANGELOG | 合格 |
| 版本管理白名单提交 | `git diff --cached`、`git show --stat HEAD` | 合格 |

暂存清单已经按本轮文件与独立文档 hunk 复核。正式配置、文档与证据包含在已推送的实现提交 `f05ed06d64efbf4c73541f5d2480dcee399b293c` 中。
