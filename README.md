# IndexVoiceStudio

IndexVoiceStudio 是面向小说、故事和新闻长文本的本地声音制作工作台。它在 IndexTTS 2.5 推理能力之上提供 AI 全文导演、角色音色设计、可编辑分句、逐句增量重生成、纠音规则、完整音频拼接和分轨交付。

[![Release](https://img.shields.io/badge/release-1.0.0-dc5000)](https://github.com/sunshaoxuan/IndexVoiceStudio/releases/tag/v1.0.0)
[![Engine](https://img.shields.io/badge/IndexTTS-2.5-382416)](https://github.com/index-tts/index-tts)
[![Platform](https://img.shields.io/badge/platform-Windows-5c2f1d)](#运行环境)

## 产品能力

### 长文本工程

* 一个工程持久保存完整原文、体裁、章节、人物、分句、纠音、导演参数和操作历史。
* AI 全文分析按语义识别章节、旁白、对白、人物关系和朗读边界。
* 人工修改后的断句、角色分配和导演参数可以在稿件调整后重新应用。
* 页面明确显示未保存状态，保存后写入工程文件，离开页面前提供修改保护。

### 角色与音色

* 每个人物使用独立角色资产卡片，集中管理性别、年龄、详细小传、形象、声音条件、频率目标和声音样本。
* 性别和年龄会产生建议基频区间，可用滑块选择目标频率来区分同类人物声音。
* 人物小传、年龄、性别、目标频率、声音条件、表达节奏和导演补充共同形成角色音色设计指令，年龄段还会约束声带厚度、共鸣位置、亮度和自然质感。
* 每个角色按当前配置收集一至六个通过年龄与性别门禁的候选，按实测基频选择最佳样本。未通过门禁的尝试只进入审计记录，不会进入永久音色库或候选列表。
* 候选三选一只更新角色当前采用的稳定音色。分句始终绑定稳定角色 ID，渲染时再从角色资产解析当前音色，因此切换或重新生成角色声音无需逐句重新选择样本。
* 跨角色导演补充按结构化来源隔离，只检查当前工程引用的音色，角色自身声音描述中的同词不会触发误重新生成。
* Qwen3 TTS VoiceDesign 生成角色音色，生成结果经过运行环境和模型文件健康检查。
* 音色模型和 IndexTTS 渲染模型使用独立常驻运行时，连续逐句生成可以复用已加载模型。
* 可配置 OpenAI 兼容服务扩写详细人物小传，并通过 GPT Image 或兼容图像模型生成稳定人物形象。
* 角色卡片支持声音样本试听、焦点定位和重新生成控制。
* 除旁白外的角色可以删除。已有分句引用会在确认后重分配给旁白，工程内角色资产和导演记忆同步清理。

### 分句导演

* 每句可以编辑角色、语言、合成文本、态度、情绪、强度、节奏和句后停顿。
* AI 先建立全文角色别名和场景注册表，再进行逐块分句。场景页支持复核地点、时间、参与人物、叙事视角、基调和低置信度说话人。
* 分句只保存角色 ID，不保存候选声音样本 ID。工程的 `voice_files` 用于资产登记，渲染还会按角色当前音色从永久音色库动态解析。
* 打开旧工程时会原子回填缺失的当前角色音色资产。Render Runtime 会校验合成源码指纹，代码更新后自动淘汰旧进程。
* 支持连续分句合并和单句按光标位置拆分。
* 支持逐句重新生成，并在启动任务前保存当前工程。
* 分句变化只使受影响缓存失效，其他已生成片断继续保留和试听。
* 纠音变化按实际命中范围失效片断，未命中的新规则不会清空现有结果。

### 完整交付

* 使用当前全部有效片断串接完整音频，缺失片断时给出具体句号。
* 完整交付包括 WAV、角色分轨、章节音频、导演清单和 ZIP 包。
* 已生成的完整交付在工程调整后保留并标记过期，由用户决定是否删除。
* WAV 可直接下载，MP3 在下载时由 FFmpeg 实时编码，不保存额外副本。

## 技术架构

| 层 | 技术 | 职责 |
|---|---|---|
| 产品界面 | React 19、Ant Design 6、TypeScript | 工程、角色、分句、纠音与交付操作 |
| 产品 API | Node.js 24、Fastify 5 | 工程持久化、任务互斥、缓存失效、文件与媒体流 |
| 文本导演 | Python、Ollama 或 OpenAI 兼容 Structured Outputs | 全文角色场景注册、分句导演、置信度证据和历史操作重应用 |
| 音色设计 | Python、Qwen3 TTS VoiceDesign | 角色音色生成和永久音色库 |
| 音频渲染 | Python、IndexTTS 2.5 | 分句合成、缓存复用、完整音频与分轨交付 |
| MP3 下载 | FFmpeg、libmp3lame | 从完整 WAV 按请求实时编码 |
| 人物与图像服务 | OpenAI 兼容 Chat Completions 与 Images API | 详细人物小传和角色形象 |

详细设计见 [产品架构](docs/PRODUCT_ARCHITECTURE_zh.md) 和 [小说工程需求](docs/NOVEL_PROJECT_REQUIREMENTS_zh.md)。

## 运行环境

当前产品启动和验收环境为 Windows。推荐配置如下：

* Windows 10 或 Windows 11
* NVIDIA GPU，建议 12 GB 以上显存
* NVIDIA 驱动和 CUDA 12.8 兼容运行环境
* Python 3.10 或 3.11
* Node.js 24 LTS
* pnpm
* Git
* uv
* Ollama
* FFmpeg 8 或兼容版本，`ffmpeg.exe` 需要位于 PATH

模型权重、用户工程、缓存、输出音频和运行日志均被 `.gitignore` 排除。

## 安装

### 1. 克隆仓库

```powershell
git clone https://github.com/sunshaoxuan/IndexVoiceStudio.git
Set-Location .\IndexVoiceStudio
```

### 2. 安装 Python 环境

先安装 [uv](https://docs.astral.sh/uv/)，然后执行：

```powershell
uv sync --extra test
```

该命令会创建项目专用 `.venv`。Windows 环境需要使用 CUDA 12.8 对应的 PyTorch 依赖。

### 3. 下载 IndexTTS 2.5 模型

```powershell
uv tool install huggingface-hub
hf download IndexTeam/IndexTTS-2.5 --local-dir checkpoints
```

也可以使用 ModelScope：

```powershell
uv tool install modelscope
modelscope download --model IndexTeam/IndexTTS-2.5 --local_dir checkpoints
```

模型目录至少应包含 `checkpoints/config.yaml` 和相应权重文件。模型许可与使用限制以根目录 [LICENSE](LICENSE) 为准。

### 4. 安装角色音色设计环境

```powershell
.\scripts\setup_voice_design_windows.ps1
```

脚本会创建独立的 `.venv-voice-design`，安装 `qwen-tts`，下载 Qwen3 TTS VoiceDesign 模型和 tokenizer，并执行导入与模型文件检查。

### 5. 准备本地文本导演模型

安装并启动 [Ollama](https://ollama.com/)，然后下载当前产品使用的模型：

```powershell
ollama pull qwen3:8b
```

产品默认连接 `http://127.0.0.1:11434`。

### 6. 安装 Node.js 和 pnpm

安装 Node.js 24 LTS 后执行：

```powershell
npm install --global pnpm
```

如果命令不在 PATH，可以设置：

```powershell
$env:INDEXTTS_NODE = "C:\Program Files\nodejs\node.exe"
$env:INDEXTTS_PNPM = "C:\Users\<用户>\AppData\Roaming\npm\pnpm.cmd"
```

## 启动

```powershell
.\scripts\start_indextts25_windows.ps1
```

### Docker GPU 运行

Docker 部署会把模型、工程、运行配置和成果物挂载为独立持久目录：

```powershell
docker compose up -d --build
```

访问 `http://127.0.0.1:7864/`。完整的启动、开机恢复和迁移方法见 [Docker 部署说明](docs/DOCKER_DEPLOYMENT_zh.md)。

启动器会安装锁定的前端依赖、构建生产页面并在以下地址启动产品：

```text
http://192.168.20.54:7864/
```

端口 7864 是产品专用端口。启动脚本会停止该端口当前监听进程，然后在所有网络接口上启动本版本。Windows 防火墙入站规则应将 TCP 7864 的远程地址限制为 `LocalSubnet`。

完成过一次构建后可以跳过构建：

```powershell
.\scripts\start_indextts25_windows.ps1 -SkipBuild
```

更完整的 Windows 运行说明见 [WINDOWS_LOCAL_SETUP_zh.md](WINDOWS_LOCAL_SETUP_zh.md)。

## 基本制作流程

1. 新建工程，选择体裁并粘贴完整稿件。
2. 执行 AI 全文分析，复核角色、章节和分句。
3. 打开人物卡片，核对性别和年龄，完善详细人物小传，调整结构化声音特征、目标频率、生成策略和角色专属试听文本，并按需生成角色形象。
4. 在分句导演中调整合成文本、角色、情绪、节奏和停顿。
5. 逐句生成和试听需要修改的片断。
6. 使用“串接全部已生成片断”快速形成完整交付，或执行完整音频生成补齐缺失片断。
7. 下载 WAV、实时 MP3、分轨包和导演清单。

## 全局 AI 设置

工程控制区提供“全局 AI 设置”。该设置统一控制全文分析、人物小传和角色图像，所有工程共用。全文分析可以选择本地 Ollama 或 OpenAI 兼容 Endpoint，并分别设置全文模型、Ollama 地址和分析块长度。兼容服务继续配置 Endpoint、API Key、兼容文本接口、人物小传模型和图像模型。全文分析选择兼容 Endpoint 时与人物小传共用该文本接口。Endpoint 推荐填写包含 `/v1` 的基础地址，例如：

```text
http://ccnode.briconbric.com:49530/v1
```

人物小传模型可以配置为兼容服务实际暴露的 Gemini、Claude 或其他文本模型名，图像模型可以配置为 GPT Image 或该服务支持的其他图像模型名。人物小传可以选择 `/responses` 或 `/chat/completions`，图像使用 `/images/generations`。

填写 Endpoint 与 API Key 后，点击“测试连接并加载模型”。系统调用兼容 `/models` 接口并把当前 Key 可用的模型加载到两个可搜索下拉框。模型列表没有包含服务端支持的别名时，也可以直接输入模型名。当前选择不在可用列表时，设置窗口会显示警告。

本机 Cockpit 与远端节点是两个独立入口。使用本机 Cockpit 时，填写当前实际监听的回环 Endpoint、Cockpit API Key 和需要的 Instance ID，并把文本接口选择为 Responses API。远端节点必须使用远端自己的 API Key 和模型映射。本机可见模型不会自动同步到远端。

回环地址允许使用 HTTP。公网 HTTP 会以明文传输 Bearer Key，产品默认阻止测试和 AI 调用；推荐先配置 HTTPS。只有在设置窗口明确启用风险开关后，公网 HTTP 请求才会发出。

全文分析选择兼容 Endpoint 时，系统会发送当前工程原文。调用小传扩写时，系统会发送角色名称、年龄、性别、当前小传和稿件中该角色附近的证据。调用图像生成时，只发送角色名称、年龄、性别、人物小传和角色形象提示。API Key 保存于本机 `runtime-output/product-settings.json`，读取接口只返回是否已经配置。

角色形象默认使用“电影感漫画”。人物卡片内置电影感漫画、清爽赛璐璐、柔光水彩漫画、黑白悬疑墨线、复古网点印刷、霓虹科幻漫画、叙事绘本厚涂、东方水墨漫画、华丽幻想漫画、都市速写漫画、柔彩情感漫画、动态动作漫画和轻巧 Q 版漫画。每种预设以线条、上色、光影、材质和构图特征描述，不使用作品、画师或商业风格名称。只有明确选择“真人写实摄影”时，提示词才要求真人效果。还可以填写服装、道具、神态和背景等补充视觉要求。

角色列表使用 4∶3 头像画幅，并把列表裁切焦点放在人物上部，优先展示完整人脸、头顶和肩部。角色编辑器继续提供更大的独立形象预览。

## 高级角色声音设计

每张角色卡片独立保存声音重量、音色亮度、共鸣位置、声带状态、粗糙度、气息量、鼻音程度、吐字锐度、语速、停顿密度、音高起伏和情绪外放十二项声音特征。这些滑块会转换为明确的 Qwen3 TTS VoiceDesign 自然语言指令。年龄变化会先载入对应年龄段的建议组合，随后可以逐项微调。

“生成策略与模型原生高级参数”提供稳定、平衡、探索和高级自定义四种模式。高级模式可以调整主采样与 Subtalker 的 Temperature、Top K、Top P、采样开关，以及重复抑制、随机种子、最大生成 Tokens 和候选数量。参数按角色独立进入 `generate_voice_design`，并进入永久音色缓存签名。

每个角色可以填写一段专属试听文本，并请求一至六个合格候选。显式选择女性或男性时，系统最多执行请求数量三倍的内部尝试，达到所需合格数量后停止。只有通过当前性别门禁的候选进入永久音色库和角色卡片，卡片显示种子、实测中位基频、性别校验结果和试听控件。旧候选缺少当前校验版本时标记为历史候选待重新校验。点击“采用此候选”只切换当前角色的稳定音色。

女性和男性的真实模型对照验证可以执行：

```powershell
.\.venv-voice-design\Scripts\python.exe .\scripts\validate_voice_gender_distinctiveness.py `
  --output .\docs\evidence\female-voice-generation `
  --candidate-count 2
```

验证使用相同试听文本生成三十五岁女性与男性声音，检查合格候选数量、女性门禁、男女中位基频差异和样本文件。声学校验用于拦截明显交叉性别结果，最终自然度和性别听感仍应由用户试听确认。

不同年龄的真实模型验证可以执行：

```powershell
.\.venv-voice-design\Scripts\python.exe .\scripts\validate_voice_age_distinctiveness.py `
  --output .\docs\evidence\advanced-voice-controls\age-samples
```

验证使用相同试听文本生成十岁、三十五岁和七十二岁男性声音，并比较中位基频、频谱重心、时长和频谱平坦度。声学指标用于检查年龄方向性，最终感知年龄仍应由用户试听确认。

## 测试

### 产品前端和 Node API

```powershell
Set-Location .\product-studio
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

### Python 非 GPU 测试

```powershell
Set-Location ..
.\.venv\Scripts\python.exe -m pytest -m "not gpu"
```

GPU 与真实模型测试需要完整模型和可用 NVIDIA 环境。

## 数据目录

| 路径 | 内容 | Git 状态 |
|---|---|---|
| `outputs/novel-projects` | 用户工程、角色形象、分句缓存、完整交付 | 忽略 |
| `outputs/voice-library` | 永久角色音色 | 忽略 |
| `runtime-output/product-jobs` | 任务状态和日志 | 忽略 |
| `runtime-output/product-settings.json` | 本机兼容服务配置与 API Key | 忽略 |
| `checkpoints` | IndexTTS 与 VoiceDesign 模型 | 忽略权重 |
| `product-studio/dist` | 前端生产构建 | 忽略 |

发布代码不包含用户稿件、用户生成音频和模型权重。

## 版本

当前产品版本：`1.0.0`

IndexTTS 推理引擎基线：`2.5.0`

版本历史和升级说明见 [CHANGELOG.md](CHANGELOG.md)。产品遵循语义版本：

* 主版本用于不兼容的工程格式或运行方式变化。
* 次版本用于兼容的新功能。
* 修订版本用于兼容的缺陷修复。

## 上游来源与许可

IndexVoiceStudio 基于 [IndexTTS](https://github.com/index-tts/index-tts) 开发，保留原项目提交历史、版权声明、模型使用许可和免责声明。

IndexTTS 引擎的原始多语言文档位于：

* [简体中文](docs/README_zh.md)
* [English upstream documentation](https://github.com/index-tts/index-tts/blob/main/README.md)
* [日本語](docs/README_ja.md)
* [Español](docs/README_es.md)
* [العربية](docs/README_ar.md)

使用、修改或分发前请阅读 [LICENSE](LICENSE)、[LICENSE_ZH.txt](LICENSE_ZH.txt) 和 [DISCLAIMER](DISCLAIMER)。本产品对原模型的修改不代表原权利人对这些修改提供认可、保证或担保。

## 安全与合规

* 只使用已经获得授权的参考音频、稿件和人物声音。
* 遵守适用的著作权、人格权、隐私权和合成内容标识要求。
* 生成结果进入正式发布前应由人工复核。
* 本地服务默认只监听 `127.0.0.1`，公开网络部署需要另行配置身份认证、访问控制和 TLS。

## 仓库

产品仓库：[sunshaoxuan/IndexVoiceStudio](https://github.com/sunshaoxuan/IndexVoiceStudio)

问题反馈：[GitHub Issues](https://github.com/sunshaoxuan/IndexVoiceStudio/issues)
