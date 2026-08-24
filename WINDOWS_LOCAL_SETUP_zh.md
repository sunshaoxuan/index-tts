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
| AI 文本导演模型 | qwen3:8b |
| AI 角色音色模型 | Qwen3-TTS-12Hz-1.7B-VoiceDesign |

## 建立环境

```powershell
uv sync --extra webui --extra test
uv tool run --from huggingface-hub hf download IndexTeam/IndexTTS-2.5 --local-dir .\checkpoints
uv run python -c "from indextts.utils.examples_downloader import ensure_examples_available; ensure_examples_available()"
```

AI 长篇导演默认连接本机 Ollama。已验证的本机建立方式如下：

```powershell
docker run -d --gpus=all --name ollama -p 127.0.0.1:11434:11434 -v ollama:/root/.ollama ollama/ollama:0.23.3
docker exec ollama ollama pull qwen3:8b
```

角色音色设计使用独立虚拟环境，避免与 IndexTTS 的 Transformers 版本互相影响：

```powershell
.\scripts\setup_voice_design_windows.ps1
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
  -AiModel qwen3:8b `
  -AiTimeout 300 `
  -AiChunkChars 1400
```

生产站点提供参考音频、11 个可选择并试听的演示音色、目标文本、五种语言、模型级时长系数、完整情绪控制、生成预览与 WAV 下载。演示音色列表标明编号、示例语言、内容类型和时长，选择后自动载入音色参考播放器。

情绪控制包含以下模型原生方式：

- 沿用音色参考情绪。
- 使用独立情绪参考音频，并设置情绪作用强度。
- 使用喜悦、愤怒、悲伤、恐惧、厌恶、低落、惊喜、平静八维向量，并设置情绪作用强度和随机采样。
- 使用本地 QwenEmotion 模型解析情绪描述文本，并设置情绪作用强度和随机采样。描述留空时使用目标文本判断情绪。

视觉采用 OneHR 式浅灰工作区、白色卡片、橙色主操作和清晰状态信息，产品身份为 Index Voice Studio。

## AI 长篇导演

AI 长篇导演使用本机 `qwen3:8b`，原稿不会发送到外部业务系统。完整流程如下：

1. 先创建或打开小说工程。每部小说使用独立目录，持续保存原稿、章节、角色、音色、纠音表、过程缓存和每次成品。
2. 选择自动识别、小说、新闻或故事体，再粘贴全文并填写导演补充。
3. AI 清洗全文，按自然边界分块，并在块间复用已有角色表。
4. 每条结果同时保留精确原文片段和可朗读清洗稿。程序要求全部原文片段按顺序重建全文。模型只调整空白或中英文引号样式时，程序会恢复原文精确切片；存在漏文、实质改写或顺序变化时会自动细分并继续处理。
5. AI 识别旁白、人物、主播、记者和采访对象，逐句标注态度语气、八类情绪、情绪强度、表达节奏、语言和句后停顿。模型把“某人说：”与引号内台词合并时，程序会再次拆成旁白归属和人物台词。
6. 角色表可以新增人物，分句可以通过已知角色选择器批量修改归属，适合校正引号、姓名、旁白和心理活动误判。
7. 选择角色音色策略。AI 设计条件、固定种子和模型共同形成稳定音色签名，相同签名直接复用永久音色库。角色表可以修改音色设计条件、表达节奏和重新生成标记，也可以选择其他工程保存的固定音色。
8. 在全篇纠音表中维护人物名、专有名词和多音字组合的固定朗读替换。规则在合成前应用于全部分句，原始文本和实际朗读文本同时进入清单。
9. IndexTTS 按脚本顺序生成逐句 WAV、章节音频、角色轨道和完整音频。相同文本、音色和导演参数会复用工程分句缓存。

小说模式强调旁白、人物台词、动作和心理的层次。新闻模式强调主播的客观克制，并将记者、采访对象分别分轨。故事模式强调讲述感和人物态度变化。自动识别模式由 AI 在三种体裁中选择。

每部小说位于 `outputs/novel-projects/<工程ID>`。每次正式输出位于工程的 `renders/<时间-标题>`，包含：

- `full-audio.wav`：完整顺序音频。
- `segments/*.wav`：逐句音频。
- `chapters/*.wav`：按章节连续拼接的音频。
- `tracks/*.wav`：每个角色的连续分轨音频。
- `director-script.csv`：可审查的逐句脚本。
- `director-manifest.json`：角色、音色、文本和参数清单。
- `directed-audio-package.zip`：上述文件的完整交付包。

长任务会显示当前阶段、进度和取消按钮。AI 文本分析与角色音色设计使用独立进程，分析输入、结果、状态和日志保存到工程。完整音频生成在当前分句完成后停止，已经完成的工程分句缓存继续保留。

永久 AI 角色音色保存在 `outputs/voice-library`，每条音色包含稳定音色 ID、参考 WAV、完整设计条件、模型和固定种子。旧版 `outputs/role-voices` 下的 WAV 会按音频内容生成稳定旧版音色 ID 并迁移到永久库；旧版没有保存的设计条件会明确标记为缺失。系统会先卸载 Ollama 文本模型和 IndexTTS 音频模型，再加载 VoiceDesign 模型。音色生成结束后独立进程退出并释放显存，随后自动恢复 IndexTTS 音频模型。

`qwen3:8b` 首次载入需要一定时间。长文默认按 1400 字符上限在自然段或句末切块，处理前会释放 IndexTTS 显存，让文本模型获得完整 GPU 资源。单个文本块超过 300 秒时会立即按自然边界继续拆分，避免用相同大块重复请求。最小文本块仍超时时才会停止，并在状态区显示具体失败位置。实际总处理时间会随文本长度和最终文本块数量增加。

AI 返回结果连续两次未通过原文覆盖校验时，该文本块也会自动继续拆分。细分到 320 字符左右仍无法通过时，系统使用确定性标点边界生成无损安全分段，保留全部原文并继续整篇任务。完成摘要会显示“安全分段块”数量，便于人工复核这些局部段落。AI 服务连接失败属于独立服务错误，不会伪装成安全分段成功。

## 声学时长与自然表达节奏

单句创作页保留“时长系数”作为模型级声学时长试验参数。该参数不等同于自然人类语速。

该参数进入 IndexTTS 2.5 的 S2M 长度调节器：

```text
target_lengths = semantic_length * 1.72 * duration_factor
```

长度调节器按目标总长度对语义特征进行插值，无法分别表达声母速度、韵母延展、词内重音和语义停连。长篇导演固定使用中性时长系数，通过角色表达节奏、句内节奏提示、合成文本标点和句后停顿组织表演，不把整句时长倍数显示成人物语速。

## 测试

```powershell
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
```

模型推理样本保存在 `outputs`，该目录已由官方 `.gitignore` 排除。
