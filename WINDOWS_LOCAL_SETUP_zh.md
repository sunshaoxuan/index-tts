# IndexTTS 2.5 Windows 本地运行说明

本文记录本工程在 Windows 11 和 NVIDIA RTX 5070 Ti 上的已验证搭建方式。

## 来源

- 官方代码：`https://github.com/index-tts/index-tts`，标签 `v2.5.0`
- 官方权重：`https://huggingface.co/IndexTeam/IndexTTS-2.5`
- 本地代码基线：`39207d91c30899cad1e7c1b9eb678c241f678e55`

代码与权重采用 Bilibili Model Use License Agreement。使用、分发和商用前应阅读仓库及模型目录中的 `LICENSE`。

## 已验证环境

| 组件 | 版本 |
|---|---|
| Python | 3.11.13，由 uv 管理 |
| PyTorch | 2.8.0+cu128 |
| Gradio | 5.45.0 |
| GPU | NVIDIA RTX 5070 Ti，计算能力 12.0 |

## 建立环境

```powershell
uv sync --extra webui --extra test
uv tool run --from huggingface-hub hf download IndexTeam/IndexTTS-2.5 --local-dir .\checkpoints
uv run python -c "from indextts.utils.examples_downloader import ensure_examples_available; ensure_examples_available()"
```

基础运行模式不启用 DeepSpeed、Flash Attention、自定义 CUDA kernel 或 torch.compile，因此不要求本机安装 CUDA Toolkit。PyTorch CUDA wheel 和兼容驱动仍然是 GPU 推理必需条件。

## 启动

```powershell
.\scripts\start_indextts25_windows.ps1
```

默认地址为 `http://127.0.0.1:7860`。启动脚本运行面向实际创作的 `production_webui.py`，后端在支持时自动选择 BF16。官方完整演示入口 `webui.py` 仍保留用于功能对照。

生产站点提供参考音频、演示音色、目标文本、五种语言、模型级时长系数、情感参考、情感向量、生成预览与 WAV 下载。视觉采用 OneHR 式浅灰工作区、白色卡片、橙色主操作和清晰状态信息，产品身份为 Index Voice Studio。

## 语速控制

WebUI 的“时长系数”范围是 0.5 至 2.0，步进为 0.01。小于 1.0 时生成更短、更快的语音，大于 1.0 时生成更长、更慢的语音。

该参数进入 IndexTTS 2.5 的 S2M 长度调节器：

```text
target_lengths = semantic_length * 1.72 * duration_factor
```

已验证相同文本、参考音频、语义 code 和随机种子下，`0.8` 生成 3.41 秒，`1.2` 生成 5.12 秒。

## 测试

```powershell
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
```

模型推理样本保存在 `outputs`，该目录已由官方 `.gitignore` 排除。
