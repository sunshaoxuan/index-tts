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
| Ollama | 0.23.3，本机 Docker |
| AI 文本导演模型 | qwen3:14b，Q4_K_M |

## 建立环境

```powershell
uv sync --extra webui --extra test
uv tool run --from huggingface-hub hf download IndexTeam/IndexTTS-2.5 --local-dir .\checkpoints
uv run python -c "from indextts.utils.examples_downloader import ensure_examples_available; ensure_examples_available()"
```

AI 长篇导演默认连接本机 Ollama。已验证的本机建立方式如下：

```powershell
docker run -d --gpus=all --name ollama -p 127.0.0.1:11434:11434 -v ollama:/root/.ollama ollama/ollama:0.23.3
docker exec ollama ollama pull qwen3:14b
```

启动前可先确认模型：

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

基础运行模式不启用 DeepSpeed、Flash Attention、自定义 CUDA kernel 或 torch.compile，因此不要求本机安装 CUDA Toolkit。PyTorch CUDA wheel 和兼容驱动仍然是 GPU 推理必需条件。

## 启动

```powershell
.\scripts\start_indextts25_windows.ps1
```

默认地址为 `http://127.0.0.1:7860`。启动脚本运行面向实际创作的 `production_webui.py`，后端在支持时自动选择 BF16。官方完整演示入口 `webui.py` 仍保留用于功能对照。

端口被其他服务占用时可以指定其他端口：

```powershell
.\scripts\start_indextts25_windows.ps1 -Port 7861
```

需要修改 AI 服务或分块大小时使用：

```powershell
.\scripts\start_indextts25_windows.ps1 `
  -Port 7861 `
  -AiBaseUrl http://127.0.0.1:11434 `
  -AiModel qwen3:14b `
  -AiTimeout 300 `
  -AiChunkChars 3600
```

生产站点提供参考音频、11 个可选择并试听的演示音色、目标文本、五种语言、模型级时长系数、完整情绪控制、生成预览与 WAV 下载。演示音色列表标明编号、示例语言、内容类型和时长，选择后自动载入音色参考播放器。

情绪控制包含以下模型原生方式：

- 沿用音色参考情绪。
- 使用独立情绪参考音频，并设置情绪作用强度。
- 使用喜悦、愤怒、悲伤、恐惧、厌恶、低落、惊喜、平静八维向量，并设置情绪作用强度和随机采样。
- 使用本地 QwenEmotion 模型解析情绪描述文本，并设置情绪作用强度和随机采样。描述留空时使用目标文本判断情绪。

视觉采用 OneHR 式浅灰工作区、白色卡片、橙色主操作和清晰状态信息，产品身份为 Index Voice Studio。

## AI 长篇导演

AI 长篇导演使用本机 `qwen3:14b`，原稿不会发送到外部业务系统。完整流程如下：

1. 选择自动识别、小说、新闻或故事体，再粘贴全文。
2. 可填写导演补充，例如“克制悬疑”“新闻播报避免夸张”或“儿童故事更有亲和力”。
3. AI 清洗全文，按自然边界分块，并在块间复用已有角色表。
4. 每条结果同时保留精确原文片段和可朗读清洗稿。程序要求全部原文片段按顺序重建全文。模型只调整空白或中英文引号样式时，程序会恢复原文精确切片；存在漏文、实质改写或顺序变化时会触发一次 AI 自动纠正，第二次仍不合格时停止处理并显示错误。
5. AI 识别旁白、人物、主播、记者和采访对象，逐句标注态度语气、八类情绪、情绪强度、语速、语言和句后停顿。模型把“某人说：”与引号内台词合并时，程序会再次拆成旁白归属和人物台词；未命名人物可通过归属文字匹配已有角色轨道。
6. 在角色轨道表中为每个角色修改音色ID。可以使用 11 个内置音色，也可以上传自定义音色并填写文件名。
7. 在逐句导演表中人工校正轨道、文本、态度、情绪、强度、语速和停顿。
8. IndexTTS 按脚本顺序生成逐句 WAV、角色轨道和完整音频。

小说模式强调旁白、人物台词、动作和心理的层次。新闻模式强调主播的客观克制，并将记者、采访对象分别分轨。故事模式强调讲述感和人物态度变化。自动识别模式由 AI 在三种体裁中选择。

每次生成的正式输出位于 `outputs/director/<时间-标题>`，包含：

- `full-audio.wav`：完整顺序音频。
- `segments/*.wav`：逐句音频。
- `tracks/*.wav`：每个角色的连续分轨音频。
- `director-script.csv`：可审查的逐句脚本。
- `director-manifest.json`：角色、音色、文本和参数清单。
- `directed-audio-package.zip`：上述文件的完整交付包。

`qwen3:14b` 首次载入可能需要数分钟。模型在 Ollama 中保持加载后，后续请求会缩短等待时间。长文按默认 3600 字符上限在自然段或句末切块，实际处理时间随文本长度线性增加。

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
