# 测试结果

| 检查 | 结果 |
|---|---|
| Compose 配置解析 | 通过 |
| 差异格式检查 | 通过，仅有 Git 行尾提示 |
| 模型文件数量 | 原卷 86 + 27，SSD 113，一致 |
| 模型文件字节 | 原卷 11,656,340,093 + 4,520,165,231，SSD 16,176,505,324，一致 |
| `config.yaml` SHA256 | 一致 |
| `gpt.pth` SHA256 | 一致 |
| `codec.pth` SHA256 | 一致 |
| `s2mel.pth` SHA256 | 一致 |
| VoiceDesign `model.safetensors` SHA256 | 一致 |
| 容器状态 | healthy，RestartCount 0，`unless-stopped` |
| 模型挂载 | `indextts25-models-ssd` 到 `/app/checkpoints`，只读 |
| GPU | PyTorch 2.8.0+cu128，RTX 5070 Ti，CUDA 可用 |
| HDD 冷启动 | 约 6 分 21 秒，完成 |
| SSD 冷启动 | 163.3 秒，完成 |
| SSD 热路径 | 7.823 秒，`model_reused=true` |
| 页面 | Index Voice Studio 可打开，完整音频页可见 |
| 浏览器 Console | 0 warning，0 error |
| 浏览器截图 | 通过 |

本轮没有修改应用代码，相关测试由 Compose 解析、运行环境、真实 GPU 作业和浏览器验收覆盖。
