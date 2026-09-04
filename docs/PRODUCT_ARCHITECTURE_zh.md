# Index Voice Studio 产品架构

## Docker 运行边界

Linux GPU 镜像内置 Product Studio、Node.js 24、IndexTTS Python 环境、VoiceDesign 独立 Python 环境和 FFmpeg。`checkpoints`、`outputs`、`runtime-output`、`artifacts` 通过 Compose 从宿主机挂载，分别承担模型、用户工程、运行配置与正式成果物持久化。容器内的 Ollama 请求通过 `host.docker.internal` 到达宿主机服务。应用层镜像构建会把 Docker 启动脚本规范化为 LF 行尾，再赋予执行权限，避免 Windows 检出产生的 CRLF 破坏 Linux shebang。容器重启时会把中断任务记为明确错误，并清理只属于旧进程命名空间的 daemon 控制状态。

产品版本由根 `VERSION` 管理，Node 启动时读取并通过 `/api/health` 返回，React 品牌区显示同一值。`product-studio/package.json`、README、CHANGELOG 和 Git 标签在正式发布时使用同一版本。IndexTTS 推理引擎版本继续独立管理。

## 目标

使用独立 Web 产品架构承载长篇声音作品工程。页面组件具备原生枚举、数值约束、加载状态、错误反馈、横向大表格和响应式能力。

## 分层

| 层 | 技术 | 责任 |
|---|---|---|
| 产品页面 | React 19、Ant Design 6、TypeScript | 工程编辑、枚举单元格、任务状态、音频交付 |
| 构建 | Vite 8 | 生产资源构建和代码分割 |
| 服务层 | Node.js 24 LTS、Fastify 5 | REST API、工程校验、原子保存、Worker 编排、静态资源 |
| AI Worker | Python、Ollama | 全文分块、分句、人物识别和导演标注 |
| 音色 Worker | Python、Qwen3 TTS | 幂等角色音色设计和永久音色库 |
| 合成 Worker | Python、IndexTTS 2.5 | 分句、章节、角色轨道、完整音频和交付包 |

## API

1. `GET /api/health`
2. `GET /api/presets`
3. `GET /api/projects`
4. `POST /api/projects`
5. `GET /api/projects/:id`
6. `PUT /api/projects/:id`
7. `POST /api/projects/:id/analyze`
8. `POST /api/projects/:id/voices`
9. `POST /api/projects/:id/render`
10. `GET /api/jobs/:id`
11. `GET /api/active-job`
12. `GET /api/projects/:id/latest-render`
13. `DELETE /api/projects/:id/renders/:renderId`
14. `POST /api/projects/:id/storyboard/regenerate`
15. `POST /api/projects/:id/scenes/:sceneId/shots/:shotId/keyframe`
16. `POST /api/projects/:id/storyboard/keyframes`
17. `GET /api/projects/:id/scene-assets/:file`

## 数据边界

Node 保存前校验作品体裁、角色类型、角色节奏、重新生成选项、语言、态度、情绪、句内节奏和纠音规则。高级音色提示允许自然语言，并进入音色签名。旧工程中的自然语言有限控制值在读取时确定性迁移为最接近的中文枚举。工程使用临时文件加原子重命名保存。

三个 Python Worker 共享单任务互斥门，避免 Ollama、Qwen3 TTS 和 IndexTTS 同时抢占 GPU。Worker 异常与启动失败都会写入终态，前端不会永久停在加载阶段。

VoiceDesign daemon 协议状态包含实际 Python 解释器、虚拟环境前缀、`qwen_tts` 包来源和模型关键文件检查结果。产品 Worker 只复用解释器、包和模型状态全部匹配的健康进程；旧协议、环境不匹配或运行时已标记不健康的进程先通过停止请求退出，再由 `.venv-voice-design` 启动。daemon 心跳保留最后请求、最后错误和释放信息，模型文件缺失会在导入 PyTorch 和分配 GPU 前返回明确错误。

完整渲染 Worker 在加载任何重量级 Python 模块前先写入内存准备阶段，并请求 VoiceDesign daemon 释放常驻模型与 CUDA 缓存。daemon 进程继续存活，后续音色任务按需重新加载模型。释放完成后执行主机可用内存门禁，再写入 PyTorch CUDA 导入阶段；内存不足时返回明确终态，避免页面把导入阻塞误显示为队列等待。

Linux 容器的可用主内存读取 `/proc/meminfo` 中的 `MemAvailable`，使门禁同时计算完全空闲页与可安全回收的文件缓存。该字段不可用时才回退到 `SC_AVPHYS_PAGES`。Windows 继续使用 `GlobalMemoryStatusEx.available_physical`。

IndexTTS 音频合成由持久 Render Runtime 处理。Node 继续为每个产品作业启动轻量 Worker 以维持活动作业 PID、工程锁和服务恢复契约，Worker 把实际请求原子写入 Render Runtime 队列并等待终态。Runtime 首次请求加载 IndexTTS 2.5，完成后保留模型；后续完整渲染和分句重新生成复用同一模型与锁。VoiceDesign 与 Render Runtime 具有双向释放协议，角色音色生成前释放 IndexTTS，音频合成首次加载或释放后重载前释放 VoiceDesign，避免两个 GPU 模型同时驻留。

Node 产品服务在 `runtime-output/product-jobs/job-queue.json` 持久保存后台模型任务队列。全文分析的模型键由 Provider、Endpoint 和模型名组成，角色音色与音频合成分别使用 VoiceDesign 和 IndexTTS 稳定模型键。同一工程的后续任务显式依赖此前仍活动或等待的任务，其他工程任务可以独立进入可运行集合。调度器先拦截未完成依赖并传播依赖失败，再从可运行集合中优先选择与上一驻留模型相同的任务，同模型内按进入时间和任务 ID 稳定排序。活动任务与等待任务都会锁定对应工程，防止队列输入在执行前发生漂移。任务状态公开 `modelKey`、`dependencies` 和 `queuePosition`，服务恢复时会清理已终止记录并继续调度有效等待项。

当前后台模型队列覆盖 AI 全文分析、AI 全量分镜重建、角色音色生成、完整音频、严格串接和分句重新生成。AI 全量分镜重建复用全文导演模型键与分析 Worker，在新分析结果和当前人工分句之间按无空白原文覆盖对齐，只回写场景、分句 `scene_id` 和镜头清单。人物小传扩写与角色画像仍是请求内完成的即时兼容服务调用，不写入该后台队列。

Node 服务恢复时还会检查 Render Runtime 的 `busy` 状态和 `.processing` 请求信封。只有运行时 PID 存活、请求 ID 合法、输入与状态文件严格位于一个产品任务目录、工程存在且任务状态未结束时才接管。接管任务继续使用原任务 ID、状态文件和已生成片断，并恢复工程锁；状态进入 `complete` 或 `error` 后清除活动任务记录。

`DELETE /api/projects/:id` 只接受合法工程 ID，要求目标严格位于 `outputs/novel-projects` 的单层工程目录并存在 `project.json`。活动任务锁定同一工程时返回 409。删除成功后移除该工程完整目录，`outputs/voice-library` 永久音色库不在目标范围内。前端二次确认展示工程名称和删除范围，完成后重新读取工程列表并切换到剩余工程。

项目生成操作使用可停靠容器承载完整操作组和收缩图标。停靠状态由 `edge` 与沿边中心 `offset` 组成，保存到浏览器本机存储。完整面板标题区和收缩图标通过 Pointer Events 取得拖动位移；松手后用指针到上、右、下、左四边的距离选择最近边缘，再按当前面板尺寸限制 offset，保证控件留在视口内。滚动或调整窗口大小时读取完整 `#project` 工作区边界；进入项目区或在项目区继续滚动时展开，返回主画面时收缩，标签切换也会展开。完整面板使用 10 秒空闲计时器，拖动、点击、键盘、页面标签切换、窗口变化和滚动会重置计时，计时到期后收缩到当前边缘。容器吸附和两种视图使用缓动动画，Reduced Motion 下将动画缩短。三个按钮直接复用 `runJob` 入口、活动任务锁和工程数据前置条件；项目控制栏不保留重复按钮。顶部任务进度层保持更高层级。

任务启动时，Node 在写入 Worker 输入前登记 `activeJob`，其中包含 `jobId`、任务类型和 `projectId`，并持久写入 `runtime-output/product-jobs/active-job.json`。Worker 启动后追加 PID。`GET /api/active-job` 合并活动标记与实时 `status.json`，供刷新后的 React 页面自动选择所属工程、恢复相同进度面板和继续轮询。同一工程在任务存续期间的 PUT 保存返回 409。前端同步禁用工程选择、全文、角色、分句、纠音、新建和保存操作。任务完成或失败后删除活动标记、释放锁并重新载入工程结果。

统一取消入口为 `DELETE /api/jobs/:id`。等待任务从持久队列移除并写入 `cancelled`；运行任务先写入 `cancelling`，再终止当前 Worker，最终持久化 `cancelled` 并释放工程锁。取消的依赖任务视为失败终态，依赖它的后续任务不得继续运行。音频渲染和角色音色任务还会读取对应 Runtime 的 `state.json` 与 `.processing` 请求信封，只有 Runtime 的请求 ID 合法且信封状态路径精确指向当前任务时才终止 Runtime PID，避免影响其他任务。React 的统一任务进度浮层在等待、模型加载、音频生成和串接阶段持续提供取消按钮。

人物小传扩写、角色形象、单张关键帧、全量关键帧、兼容 Endpoint 测试、全文分析服务测试和工程读取使用浏览器 `AbortController`。Node 在客户端断开时中止兼容服务或 Ollama 的上游 `fetch`，取消后的响应不再写入人物、图片或工程状态。批量关键帧状态机在每张开始前检查信号，当前请求中止后不再启动下一张，已经完成并回写的图片继续保留。

Node 服务恢复时读取持久活动标记并探测 Worker PID。进程仍存活时恢复活动锁和查询接口。进程不存在时把任务状态写成 error，说明原 Worker 已终止，随后删除活动标记并释放工程锁。该设计避免浏览器刷新丢失等待状态，也避免服务重启后展示无法继续推进的僵尸任务。

角色字段中的 `profile` 定义为基于原文证据的人物小传，`voice_hint` 定义为声音导演建议。AI Schema 保持两字段稳定，提示词要求分别覆盖人物身份关系和可听声音特征。跨文本块合并时，信息更丰富且不是姓名占位的字段可以更新先前结果。安全回退使用可审计的“信息不足”小传和中性声音建议，不伪装成充分的人物理解。

角色资产的人工替换由前端纯数据变换统一处理。源角色从活动角色表和角色资产中移除，分句表、AI 文档分句、场景参与人、说话人候选、导演补充路由、导演记忆、全文分析 ID 映射和关联工程目标映射同步切换到目标角色。目标角色的资料、形象与声音资产保持原值，源名称及别名并入目标角色别名。保存接口继续通过导演快照记录操作并失效受影响片断。后续全文分析会把前次文档中的人工确认别名加入现有角色匹配索引，使名称不同的同一人物复用稳定角色 ID。

角色替换的确认处理直接等待工程 PUT 保存完成。等待期间以前端原子状态和同步 ref 防止重复提交，Modal 禁止确认、取消、右上角关闭、Esc 和遮罩关闭，目标角色下拉停止编辑，Modal 遮罩阻断背景操作。保存过程不挂载全屏 Spin，也不清空当前工程状态，避免产生全页面刷新感。保存成功后一次性采用服务端返回工程并关闭弹窗；请求失败时保持原工程和弹窗选择，解除锁定并提示重试。

VoiceDesign 最终指令由作品体裁、只应用于当前角色的全局导演上下文、角色类型和名称、人物小传、声音导演建议、角色节奏和干声约束组成。角色编辑窗口使用 `/api/presets` 暴露的音色与节奏展开文本，在浏览器中同步预览同一契约。名字占位的旧工程在 Node 读取规范化阶段迁移为待补充小传和 `中性清晰` 预设。

导演补充在全文分析结束和每次角色音色任务开始前由当前全文分析模型重新执行语义路由，本地 Ollama 默认模型为 `qwen3:14b`。输入包括完整角色表的 ID、姓名、类型、人物小传和声音提示；输出按原子片段记录 `scope`、目标角色 ID、目标名称、可执行指令和理由，并持久化到 `document.guidance_routing`。音色任务只消费已验证且与当前导演文字、当前角色签名一致的 AI 分配结果。

语义路由验证器要求片段序号完整唯一、目标角色存在、角色点名与目标一致。明确点名旁白或人物却返回全局的结果会触发一次 AI 纠错重试，第二次仍无效则终止任务。确定性规则只承担结果验证和阻止扩散，不承担导演意图分配。

VoiceDesign 作业从本角色的 AI 分配结果、人物小传和声音导演提示推断明确性别。显式声音身份约束放在最终指令开头，并在末尾再次确认。门禁阈值同时读取年龄、性别和用户目标基频，儿童使用尚未变声区间，青少年使用变声阶段区间，成年女性使用年龄段下限与目标减 25 Hz 中的较高值。通过校验的永久音色元数据保存 `expected_gender`、`median_pitch_hz`、`gender_verified`、`gender_verification_version`、`generation_attempts` 和逐候选 `candidate_metrics`，缺少当前验证版本的显式性别缓存不会复用。

## 视觉系统

页面执行 ORYZO AI 暖暗产品编辑规范。Walnut Shadow 作为全页画布，Warm Cream 作为主要文字，Bark Brown 作为唯一填充操作面，Cork Border 用于虚线结构分隔，Ember 只用于短编辑性强调。页面使用全宽布局、紧行距展示标题、下划线输入、药丸按钮、透明卡片和零投影。

首屏使用 `hero-voice-workbench.png` 摄影产品图与 HTML 排版叠加。滚动进度映射到背景模糊、亮度、缩放、首屏文字模糊和透明度。工作区覆盖进入后，摄影背景保持固定并达到完整模糊。工作区使用 Bark Brown 半透明阅读层随内容上滑，内部卡片和表格保持透明。

顶部功能导航使用首屏绝对定位，随首屏一起离开视口。工作区以独立 100vh 分区从视口顶部进入，桌面端保留 102px 顶部安全距离，移动端保留 88px。该结构消除固定导航与工程内容共享同一层级造成的文字重叠。

Workspace、Voices、Director、Delivery 菜单控制 Ant Design Tabs 的 `activeKey`，并把页面滚动到工程区域。角色表和分句表使用表格内部横向滚动，页面根节点保持无横向溢出。

工程工作区使用统一四级视觉表面。`workspace-tabs` 作为六个页签的共享根节点，页签主卡使用高辨识度工作区表面，场景卡、角色卡、提示区、表格、播放器、字幕和成果物区使用逐级不同的暖色半透明填充与边界。表格标题行和交替数据行保留行级定位，移动端缩小内边距并维持同一层级关系。整个体系继续使用暖深色、奶油色文字、虚线结构和无阴影规则。

分句导演分页由 React 显式保存当前页和每页数量。`SEGMENT_PAGE_SIZE_OPTIONS` 固定提供 10、20、50、100，页大小选择器关闭文本搜索。表格数据或页大小变化时，`clampSegmentPage` 把当前页限制在有效页数范围内；工程切换时回到第一页。分页区同时显示当前范围与总分句数。

分句导演表采用一个复合内容列。每个 Ant Design Table 数据行内部由 `segment-row-primary` 和 `segment-row-secondary` 两个网格层组成，第一层承载定位、身份和表演选择，第二层承载原文、合成文字、时长参数和片断操作。表格只设置纵向 `scroll.y`，内容层通过可收缩网格和移动端两列换行消除横向滚动。Table 的稳定行键、选择列、分页和字段更新函数保持原契约。

运行中任务使用固定前景进度面板。面板采用 Bark Brown 高不透明表面、Warm Cream 边界和 10px 高进度轨道，在 0% 时显示最小活动填充，同时明确显示工程版本锁定状态。

角色表通过 `/api/voices/:voiceId/audio` 提供行内音色试听。`voice_*.wav` 解析到 `examples`，`voice-*` 与 `legacy-*` 解析到永久音色库。接口限制文件名模式并支持 `Accept-Ranges`、206 和 `Content-Range`，用于拖动定位。

Ant Design Select 的弹层和虚拟列表使用 `overscroll-behavior-y: contain`。Ant Design 6 的列表容器采用 `overflow: hidden` 和自定义 wheel 处理。窄屏页面不再通过弹层生命周期锁定根页面，也不启用桌面分句表的 wheel containment，避免打开下拉框时视口发生纵向跳动。桌面边界 wheel 处理继续作为兼容保护。

分句表以分句序号作为稳定行键和所有编辑操作的定位依据。分页回调中的页内相对索引不参与工程数组更新。角色列提交时在同一次状态变更中更新角色 ID 与角色名称，其余可编辑导演字段复用相同稳定定位流程。

AI 是分句与角色分轨的主要决策者。提示契约要求 AI 在输出 segment 前结合完整句、相邻句、人物表和说话动作，对每组引号判断人物对白、心理活动、句内引用或普通叙述。程序在 AI 输出后验证原文覆盖、引号配对、句法连续性和角色合法性。

确定性后处理属于验证与安全修复层。完整被引号包围且不含句末语气标点的短文本，会结合左侧名称动作词、右侧“的、之、这个、一词”等连续成分和说话动作排除条件检查 AI 结果。命中的名称、招牌文字、术语或标题按原文句号边界恢复完整旁白句，保留引号供 IndexTTS 形成轻微句内停连。包含问号、叹号、句号或明确说话动作的内容继续作为对白分轨。解析器逐对处理中文双引号、中文单引号、直角引号、双直角引号和 ASCII 双引号。

对白说话人匹配先检查角色名称，再检查人物小传中的身份称呼。紧邻“说声、问道、回应”等动作的独立引号片段继承匹配角色。姓名推断会移除“亲切地、低声、冷冷地”等方式状语，避免建立带副词的伪角色轨道。

AI 提示契约禁止纯标点 segment。验证层使用 Unicode 字母和数字判断可朗读内容，中间或尾部纯标点合并到前一条，开头纯标点合并到后一条；全部结果只有标点时校验失败，不能进入音频渲染。

React 分句表使用稳定序号作为多选键。`mergeAdjacentSegments` 验证选择在完整工程数组中连续，并要求章节、角色、语言一致；合并后连续重排序号。`splitSegmentAtOffset` 按原文 Unicode 字符位置拆分，验证两侧都有文字，复制角色和导演参数，并分别设置短停顿与原停顿。所有结构修改进入未保存状态，沿用工程 PUT 保存与重载链路。

角色资产区使用响应式人物卡片网格，取代横向角色表格。每张卡片集中展示人物形象、身份、性别、年龄、详细小传、建议基频、目标基频和当前声音样本。打开卡片后使用两栏角色资产窗口编辑完整人物、视觉和声音信息；移动端改为单栏并限制所有表单控件宽度，窗口只提供纵向滚动。

角色卡片使用稳定角色 ID 保存当前焦点。工程切换、角色删除和任务结果重载时，`normalizeActiveRoleId` 保留仍存在的当前角色，失效时回到第一条。卡片点击、键盘焦点、Enter、空格、试听和编辑入口共同更新该 ID；`aria-selected`、当前人物摘要、卡片背景和左侧暖奶油标记使用同一状态。

角色卡片按可用宽度自动换列，桌面端不依赖横向滚动。人物较多时使用页面纵向浏览；当前人物卡片具有持久边框和左侧定位标记。

角色名称和角色类型保留桌面双列表单。角色表达节奏与下次生成处理采用专用单列控制组，长节奏标签在完整宽度内截断显示，下方开关说明独占一行，避免等分双列在真实中文长标签下互相侵入。

角色八列数组继续作为 IndexTTS 与既有导演流程的兼容层。扩展人物属性存入工程根级 `character_assets`，键为稳定角色 ID，字段包括 `gender`、`age`、`pitch_min_hz`、`pitch_max_hz`、`pitch_target_hz`、`portrait_url`、`portrait_prompt`、`portrait_style`、`portrait_notes` 和人物小传来源。Node 与 Python 在旧工程缺失该映射时使用同一性别推断、年龄频率建议和默认漫画风格规则补齐默认值。

OpenAI 兼容服务配置位于 `runtime-output/product-settings.json`。`GET /api/settings/ai-media` 只返回 Endpoint、模型名、文本接口模式、Cockpit Instance ID、传输风险状态和 `hasApiKey`；`PUT` 写入或清除本机密钥。图像路由配置保存 `image_model`、`image_fallback_model` 和 `image_fallback_enabled`。人物小传从角色名字命中的句子向前后各取两句并限制为 30000 字符，可显式选择 `/v1/responses` 或 `/v1/chat/completions`。角色形象和没有画面人物的关键帧使用 `/v1/images/generations`。含有画面人物的关键帧使用 multipart `/v1/images/edits`，以重复 `image[]` 字段发送角色身份参考图。两条图像响应链都兼容 `b64_json`、远程 URL 和 Gemini inline data，限制图像为 PNG、JPEG 或 WebP 且不超过 20 MB。

`image-model-routing.mjs` 按模型 ID 区分 GPT Image、Gemini Image 和普通兼容图像模型，为同一基础画面规格追加模型专用执行说明。服务进程使用内存 Map 保存模型冷却截止时间。图像请求只允许选择已配置的主模型或互补模型；启用切换后，429、503、资源耗尽、限流、配额和临时过载会按 `Retry-After` 或默认 60 秒登记冷却，再尝试另一个模型。取消与普通请求错误直接返回。含角色参考的两次尝试始终重建 multipart `/images/edits` 请求并上传全部原始角色图。生成结果返回 `requestedModel`、`model`、`modelFallbackUsed`、`modelFallbackReason` 和 `modelPromptProfile`，前端分别保存为镜头模型审计字段。

该文件同时保存全局全文导演配置：`director_provider`、`director_model`、`ollama_endpoint` 和 `director_max_chunk_chars`。`POST /api/settings/ai-media/director-test` 根据 Provider 读取 Ollama `/api/tags` 或兼容 `/v1/models`。分析任务输入只写 Provider、Endpoint、模型、接口模式、Cockpit Instance ID、块长度和设置文件路径，不写 API Key。Python Worker 仅在兼容模式下从本机设置文件读取密钥并构造 `DirectorConfig`，兼容模型发现与结构化文本请求均携带当前 Instance ID。

文本导演版本 2 先执行角色与场景注册请求。角色结构增加 aliases、confidence 和 evidence；场景结构保存 location、time、participants、narrative_perspective、mood 和 evidence。逐块分句请求复用全文注册表，每条分句保存 scene_id、speaker_candidates、speaker_confidence 和 speaker_evidence。态度与句内节奏 Schema 直接使用产品预设 ID，同时保留内部合成提示与基础时长因子的兼容表示。注册阶段失败时继续逐块识别，并在 metrics 中记录 `context_fallback`。

分镜数据采用 `document.scenes[].shots[]` 两层结构。场景边界由主题、地点、空间和叙事焦点决定；镜头边界在场景内部依据 `target_shot_seconds` 继续切分。`storyboard_captions` 来自最近交付清单中每条 WAV 的实际时长和句后停顿，Worker 先建立累计时间线，再按连续分句和目标时长形成镜头；没有完整音频时以去空白文字长度估算分组且不写 `start_seconds`、`end_seconds`。第一阶段只建立稳定镜头 ID、声音参与者、起止分句、完整 `source_text`、来源摘要、待撰写状态和可选真实时间，不从场景小记拼接镜头描述。第二阶段由 `OllamaTextDirector.author_storyboard_shots()` 以最多十二个镜头的小批次接收镜头 ID、起止分句、起止时间、完整对应原文、声音参与者、场景候选人物以及地点、方位、时间和基调，返回独立标题、`storyboard_note`、`source_evidence` 与实际可见人物 `participant_ids`。校验器要求稳定 ID 全覆盖且无重复，取景证据经规范化后必须是当前镜头原文的连续子串，画面小记必须达到视觉信息长度且不得与已处理镜头完全重复；AI 返回的画面人物必须属于已登记角色并排除 `narrator`。人物解析器还为唯一的三字以上中日文姓名建立无冲突双字短别名，按镜头顺序识别原文明示姓名，并在同一场景只有一个最近明示人物时解析“他、她、自己”等代词连续指向；确定性结果与 AI `participant_ids` 合并后保存 `participant_resolution=ai_plus_source_continuity`。全部批次成功后才在内存副本中统一回写并保存；任何批次失败时旧工程保持原状。关键帧生成以镜头作为最小单位，服务端把镜头字段覆盖到所属场景视觉上下文，并把当前镜头原文与独立画面小记同时写入图像提示。服务端按照工程角色表顺序解析 `participants`，排除 `narrator`，从角色资产 URL 安全定位当前工程或关联工程图片，校验 20 MB 上限和 PNG、JPEG、WebP 签名，并计算 SHA256。有画面人物时，提示逐张映射参考图序号、稳定角色 ID 和名称，要求保持面部结构、五官比例、发型、年龄感和标志特征；每次从原始角色图生成，避免关键帧递推的累积漂移。单张与全量路由复用该解析器，全量路由先对全部镜头完成预检。结果保存 `identity_reference_mode` 与 `reference_characters`。手工创建会占用同场景连续分句范围并按新范围写入对应原文，原镜头剩余部分自动分成连续镜头；范围缩小或拆分会清除范围已变化的画面小记、取景证据和关键帧，合并会组合原文并清除关键帧元数据。

全量关键帧由前端 `storyboardKeyframeBatch` 状态机编排。前端先调用 `POST /api/projects/:id/storyboard/keyframes` 并设置 `preflightOnly: true`，同时传递本批 `imageModel` 与 `allowFallback`。服务端完成全部镜头与身份参考解析后只返回校验数量、镜头 ID、请求模型和候选模型，不请求外部图像。预检通过后，前端按稳定队列逐张调用 `POST /api/projects/:id/scenes/:sceneId/shots/:shotId/keyframe`，每张成功即写入 React 工程状态并更新完成计数。状态机公开 `preflight`、`generating`、`complete`、`cancelled` 和 `error`，携带总数、完成数、当前序号、镜头 ID、标题、起止时间与错误信息；剩余时间由已用时间和已完成数量估算。React 以 `projectLocked` 统一控制工程切换、保存、工作区标签、分镜字段和冲突操作，任务终态解除锁定。单张与全量请求各自持有 `AbortController`，取消会中止当前 HTTP 请求，Node 把断开的请求传递为兼容服务 `AbortSignal`。批处理中已经回写的图片不会因后续取消或失败回滚。

分句数组第 15 至 18 列保存重音文字、出现序号、重音强度和生成方式。渲染器把重音目标追加到 `emo_text`，并将这些字段、生成方式和验收算法版本加入缓存签名。高级生成最多尝试九次；设置重音目标时，只有三个基础质量与重音代理同时达标的候选才能提前结束抽取，预算耗尽后从基础质量合格项中按文本比例声学代理评分保留三版。代理验收比较目标估计区间与相邻区间的 RMS 能量，保存 `stress_db`、质量指标、排序和算法版本。该指标用于受约束抽卡排序，产品界面始终披露其概率性质。分句草稿索引存在同一序号的多个历史缓存时，最新写入项覆盖旧项进入页面，避免重复显示同一分句。

分句情绪区在电脑宽度使用三列导演参数网格，情绪预览与生成方式始终跨越全部列并独占整行，使“高级三版加自主验收”保持完整可读。窄于 800 像素时其余参数切换为两列，生成方式继续跨越全部列。该规则只改变控件占位，不改变生成方式的数据值与接口契约。

角色删除在前端以纯函数同步处理工程中的四组活动引用。角色表和 `character_assets` 移除目标 ID；分句表及 `document.segments` 的目标引用改为 narrator；`document.characters` 和 `director_memory` 移除目标角色；旁白禁止删除。历史导演操作和永久音色库保持原状。用户保存工程后，现有 PUT 校验、导演历史和成果失效链继续生效。

设置窗口通过 `POST /api/settings/ai-media/test` 触发模型发现。Node 使用当前保存或请求中待保存的 Endpoint 与 API Key 请求兼容 `/v1/models`，去重并排序模型 ID 后回传浏览器。响应不包含密钥。前端把全部模型 ID 用作人物小传选择器，把包含 `image` 的 ID 优先用于主图像模型和互补图像模型选择器，并继续允许手工模型名，以兼容模型列表延迟或服务端自定义路由。分镜工作区只列出当前已保存的主模型和互补模型，确保批次请求不能绕过全局允许范围。

本机 Cockpit 和远端节点没有继承关系。Node 只向当前配置 Endpoint 发送请求；可选 `instance_id` 作为 `X-Cockpit-Instance-Id` 同时应用于模型发现、文本和同源图像请求。回环 HTTP 视为本机传输；公网 HTTP 在 `allow_insecure_http` 未明确启用时于发出请求前停止，从而避免默认明文发送 Bearer Key。远程图像 URL 只有与 Endpoint 同源时才携带认证头。

角色形象风格使用稳定枚举 ID。前端提供 13 种漫画预设和 1 种真人写实预设，Node 保存同一白名单并把风格 ID转换为线条、色彩、材质、光影和构图描述。未知或缺失风格回退到 `cinematic_manga`。只有 `realistic_photo` 进入真人提示分支，其余预设统一加入漫画角色约束。`portrait_notes` 保存用户补充的服装、道具、神态和背景要求，最终服务端提示保存到 `portrait_prompt`。这些字段不参与声音签名和角色音频失效比较。

VoiceDesign 作业读取 `character_assets`，把年龄、建议区间和目标基频写入自然语言指令，并按年龄段补充声带厚度、共鸣位置、亮度及自然质感约束。Worker 根据目标在建议区间中的相对位置追加较低、中间或较高自然音域类别。男性高音目标会追加自然男高音、较高日常说话音域以及口腔与头腔混合共鸣要求。首次尝试使用用户配置的原生采样参数和种子。首次候选偏离目标后，重试指令只保留声音身份、自然音域、声音导演、表达节奏和上次实测偏差，原生采样下限提升到 Top K 100、Top P 0.98、Temperature 1.05，并使用相对用户种子加一百开始的独立审计序列。每个模型原始输出先写入 WAV，再由锁定版本的声学依赖重新读取和测量。动态容差为目标值的百分之五，下限三 Hz，上限十 Hz。落盘原始音频同时通过年龄、声音身份和目标频率门禁后才具备候选资格。系统不执行电子变调、相位声码器校准或其他改变音色身份的后处理。前次候选低于或高于目标时，下一次生成指令会要求模型自然提高或降低基频，并明确排除假声、叠音、回声和不自然共鸣。产品 Python 与 VoiceDesign Python 锁定相同的 librosa、NumPy、Numba、SciPy、SoundFile 和 SoXR 版本，运行时校验版本一致性。候选数量由角色配置决定，范围为一至六个。声音签名包含完整指令、生成参数和自然频率门禁版本，因此性别、年龄、目标频率、采样参数、门禁算法或分析依赖变化会建立新缓存签名。人物形象字段不进入声音签名，也不触发音频片断失效。

角色声音控制扩展存放在 `character_assets.voice_traits` 和 `character_assets.voice_generation`。`voice_traits` 的十二项零到一百语义值通过 `voice_traits_instruction()` 转换为可审计的自然语言指令。`voice_generation` 逐角色传入 Qwen3 TTS 的主采样和 Subtalker 采样参数，并连同试听文本进入声音签名。旧工程读取时由 Node、TypeScript 和 Python 同一组默认值补齐。

VoiceDesign Worker 把角色配置的一至六解释为合格候选数量，并在一个驻留模型中使用可审计种子自然生成。存在目标基频的角色默认最多尝试请求数量的十二倍，总数不超过三十六次；只有显式性别时默认最多尝试请求数量的三倍。收集足量合格候选后立即停止。每次尝试记录种子、落盘原始实测中位基频、目标差值、动态容差、固定为零的修正半音数、固定为 `none` 的修正方法、年龄与声音身份门禁结果和目标频率门禁结果。产品 Worker 只把同时通过年龄、声音身份和目标频率门禁的候选注册到永久音色库并写回角色资产，未通过的尝试留在本次 Worker 审计数据。用户选择既有候选只改变该角色当前 `voice_id`。

角色音色采用两级间接引用。分句数组第三列只保存稳定角色 ID，角色八列数组第六列保存该角色当前稳定 `voice_id`，候选列表留在 `character_assets.<role_id>.voice_candidates`。VoiceDesign 默认生成三个通过年龄与性别门禁的候选并保持全部 `selected=false`，角色资产页集中提供试听和人工采用；候选采用操作只更新角色当前 `voice_id` 和候选 `selected` 状态。渲染先由分句角色 ID 找到角色，再延迟解析该角色当前音色；对 `voice-*` 和 `legacy-*` 标识可直接从 `outputs/voice-library` 定位 WAV。`voice_files` 保留为工程资产清单与上传音色兼容入口，Node 和 Python 保存链路都会回填存在的角色当前稳定音色，渲染不把该清单作为永久音色的唯一来源。

工程 GET 读取原始 JSON 后先执行角色当前音色资产协调。发现 `voice_files` 缺项时只追加永久库中真实存在的当前角色 WAV，再以临时文件和原子重命名持久化，之后执行页面规范化。该迁移不改写分句、角色、导演历史和交付状态。Render Runtime 状态记录渲染守护进程、客户端、Worker、文本导演和工程存储五个源码文件的 SHA-256 组合指纹。客户端在每次任务前比较当前指纹，旧进程缺少指纹或指纹不一致时通过停止请求退役，再启动加载当前代码的新进程。

性别基频门禁读取角色年龄。十三岁以下儿童使用尚未变声的宽容区间，青少年使用变声阶段区间，成年人继续使用成年男女门禁。年龄验证脚本通过同文十岁、三十五岁和七十二岁样本比较基频、频谱重心、时长和频谱平坦度，声学检查与人工感知验收分别记录。

每个新音色同时保存结构化 `effective_guidance_sources` 和 `effective_guidance_instructions`。跨角色污染隔离只处理当前工程角色表实际引用的音色，并比较这些结构化来源。旧元数据只解析最终指令中“本角色有效导演上下文”到“人物小传”之间的明确区域，避免角色自身声音导演与其他角色补充出现相同短语时被误判。

## 旧架构处置

旧 Gradio 产品页面和对应 UI 测试已经删除。Windows 产品启动入口只启动 Node 服务。Python 不再渲染产品页面。

产品固定使用专用端口 7864，并默认绑定 `0.0.0.0` 供局域网访问。启动器发现端口已被占用时会终止占用进程，再启动当前版本，不再通过参数切换产品端口。Windows 防火墙规则把 TCP 7864 的远程地址限制为 `LocalSubnet`。
完整交付按 `renders/<renderId>` 保存为独立版本。`GET /api/projects/:id/latest-render` 返回最近一次交付标识和下载入口。`DELETE /api/projects/:id/renders/:renderId` 在无活动任务时删除用户确认的单个交付目录，并以工程目录和合法标识校验限制目标范围。删除后前端重新查询最近一次交付，较早版本存在时立即回退显示。工程 JSON、永久音色库和其他交付目录不在删除范围内。

交付页把 `latest-render` 返回的完整音频、分轨包和导演清单路径同时用于下载按钮与成果物链接。成果物链接使用当前页面 origin 转为绝对 URL，页面显示该 URL 并提供复制操作；打开链接仍访问同一个受工程 ID 与 render ID 约束的文件 API。

`GET /api/projects/:id/render-file/:render/mp3` 按请求读取对应交付的 `full-audio.wav`，通过 FFmpeg `libmp3lame` 以 160 kbps 编码并把 stdout 直接流式返回为 `audio/mpeg`。当前完整音频为 22050 Hz 单声道，160 kbps 是该 MPEG-2 Layer III 采样率档位支持的最高标准码率。服务端不写入 MP3 文件；客户端下载中止时终止本次编码进程。该链路只做格式转换，不进入 Python Worker，也不加载 TTS 模型。

分句导演表为实际 `.ant-table-body` 增加双轴 `overscroll-behavior: contain`。页面级非 passive wheel 边界保护只匹配 `.segment-table`，在纵向或横向边界阻止默认滚动并停止事件传播；表格仍有可用滚动范围时保留原生滚动。

分句音频缓存键由实际朗读文字、语言、音色文件摘要、情绪提示、强度和时长因子共同计算。常规完整渲染复用全部命中缓存，单句重生成通过 `force_segment_orders` 只覆盖指定缓存，严格串接通过 `cache_only` 禁止模型推理。每次渲染仍从全部片断重新生成完整音频、章节音频、角色分轨、CSV、JSON 和 ZIP，使重新生成的片断自动进入最新完整交付。

`GET /api/projects/:id/latest-render` 读取最新 `director-manifest.json`，把所有 segment 映射为受工程和交付标识约束的音频链接。React 分句表使用原文和合成文字双重一致性把片断放回对应行，防止旧交付序号与新断句错配；匹配行展示实际纠音命中并提供逐句重生成。

交付清单中的片断路径在取文件名之前统一把 Windows 反斜杠转换为 POSIX 分隔符，使 Linux Docker 与 Windows 本机返回同一受控 URL。片断播放器通过媒体事件区分元数据加载、可播放、缓冲、零时长和读取失败；手工重新加载会重新挂载播放器，并向 URL 添加递增查询参数以绕过浏览器失败缓存。重新加载只读取既有音频，不进入 TTS 推理流程。

分句导演的缺失片断过滤直接复用同一匹配函数，从当前分句数组中过滤出无法匹配片断的记录，因此筛选提示、行内空状态和重新生成后的退出行为使用同一事实来源。筛选结果只作为 Table 的 `dataSource`，不会写入工程或服务端；切换筛选会清除临时多选并重置分页，片断列表刷新后页码按当前可见数量自动收敛。

分句删除复用表格跨页选择和工程 PUT 保存链路。前端 `deleteSegmentsByOrder` 校验全部所选序号仍然存在，移除目标记录并从 1 连续重排剩余分句；确认弹窗明确说明正文原稿继续保留，删除只缩小语音生产范围。服务端成果失效使用排除序号的完整分句身份比较，因此被删除记录对应的缓存和交付片断会失效，后续原文、合成文字、角色、语言与导演参数未变化的片断可继续匹配，并在 `latest-render` 协调阶段迁移到当前序号。

工程 PUT 在服务端读取当前 `project.json`，按导演字段计算变化类型，追加 `director_history`，并更新 `director_memory` 快照。客户端携带的历史字段不参与覆盖。AI 分析 worker 读取分析前的角色与分句，`director_memory.reapply_director_memory` 使用 `SequenceMatcher` 建立单调边界映射；相似度达到门槛时按旧分句边界重建新稿片段，恢复稳定角色和导演参数。仅在片段原文未变化时保留人工合成文字，防止修改稿件后朗读旧文字。重应用报告写入 document、任务结果和操作历史。

工程保存请求只上传用户可编辑字段，不上传由服务端维护的 `director_history` 和 `director_memory`。工程读取与保存响应保留历史次数、变化类型和时间等摘要，省略每次操作的完整 `snapshot`；磁盘中的审计历史和最新导演记忆保持完整。工程 PUT 单路由保留 64 MiB 请求上限，用于兼容部署前已经打开且仍持有大型历史快照的页面；该页面完成一次保存后会收到轻量响应，后续保存恢复为小请求。分句重生成仍先通过保存门禁，再提交仅含分句序号与生成方式的任务请求。

工程 PUT 在保存导演变化时同步执行成果失效。服务端以旧分句完整导演状态和发生变化的角色 ID 定位受影响片断；纠音表变化使用与 Python 合成流程相同的启用规则、长词优先顺序和全量替换语义，分别计算每条旧分句在变化前后的实际朗读文字，只把结果不同的分句纳入失效范围。未命中当前分句的纠音变化产生空失效集合。服务端从 `process/segment-fragments.json` 移除受影响索引，并删除 `process/segment-cache/<cache-key>.wav`。既有 `renders/<renderId>` 交付目录继续保留；只有导演清单包含受影响片断的交付才写入 `.stale.json`，记录过期时间、变化原因和失效缓存键。连续编辑时累积原因和失效键，防止文字恢复后重新暴露已删除片断。`latest-render` 依据导演清单时间选择最新交付，过期标记不会改变交付顺序；接口过滤已失效片断并返回过期状态、时间和原因。页面保留完整音频播放、下载和用户二次确认删除入口。

React 分句编辑事件在调用工程状态更新前同步登记 dirty 状态，避免把保存按钮的可用性依赖于另一个状态更新函数的执行时序。工程控制区和分句导演区同时显示未保存或已保存状态。dirty 状态存续期间注册 `beforeunload` 保护，浏览器刷新或关闭会要求用户确认。完整生成、逐句重生成和严格串接继续复用统一的 `save()` 门禁，任务启动前将当前工程写入服务端；保存完成后 dirty 状态清除，按钮禁用表示当前内存内容已经写入工程文件。

分句表在原有 12 列末尾追加情绪演绎预设和情绪细化描述。服务端与 Python 表格迁移器为旧工程补入 `auto` 和空描述。Product Studio 从 `/api/presets` 读取演绎选项、详细英文提示及建议权重；选择具体预设时同步采用建议权重，自定义文本可以叠加到任一预设。渲染器先组合显式预设提示和细化描述，再追加角色节奏、句内节奏、态度与基础情绪，并把最终文本作为 `emo_text`、原情绪强度列作为 `emo_alpha` 传入 IndexTTS 2。最终文本和权重同时写入缓存键与导演清单，保证任何演绎变化都不会误用旧片断。

分句导演的第二层使用具名 CSS Grid 区域。桌面编辑行依次分配原文、合成文本、句内节奏与停顿，片断区在下一行占满全部列，候选区因此获得完整内容宽度。候选网格在大于 1200px 时显示三列，1200px 以下显示两列，800px 以下显示一列。800px 以下原文和合成文本分别占满一行，节奏与停顿保留两列。字号合同由布局测试锁定，原文与合成文字为 16px，控件为 15px，标签、片断说明和按钮为 14px，候选说明为 13px。片断说明使用正常换行，Table 继续禁止横向滚动。

桌面分句表保留 Ant Design 的 560px 初始纵向滚动值作为安全回退。进入分句导演页签后，前端读取视口高度和表格顶部坐标，扣除 132px 的表头、分页及底部安全空间，把结果写入 `--segment-table-body-height`。结果下限为 560px。ResizeObserver、窗口 resize 事件和被动 scroll 事件负责在容器尺寸、窗口尺寸或表格可视位置变化后重新计算，连续事件通过动画帧合并。800px 及以下由后置响应式规则把正文最大高度恢复为无上限，继续使用页面自然滚动。

全局 Ant Design message 容器使用左右 12px 的视口安全边界，并显式清除组件默认的水平半宽位移，避免 `left: 12px` 与 `translateX(-50%)` 叠加后把提示推到视口外。每条 notice wrapper 使用 Flex 水平居中，内容最大宽度为 520px，并允许长错误文字换行。提示顶部至少为 64px，使其位于顶部工程操作浮条下方；安全区域更高时按 `safe-area-inset-top` 增加距离。

角色参考音频通过 `PUT /api/projects/:id/roles/:roleId/reference-audio` 以原始二进制上传。服务端按文件头识别 WAV、MP3、FLAC、M4A、AAC 或 OGG，限制 25 MB，使用 FFmpeg 截取最长 60 秒并转换为 24 kHz 单声道 PCM WAV。原始字节的 SHA-256 摘要生成稳定的 `voice-upload-*` 标识，标准化音频和来源元数据写入 `outputs/voice-library`。接口只验证工程并注册永久音色，因此尚未保存的手工新角色也能使用；前端将返回标识写入角色草稿，用户应用角色设置并保存工程后，现有角色音色解析和分句渲染链路自动使用该参考音频。上传过程中角色卡片禁止关闭和其他交互。

标准角色参考样本使用独立的 `standardize` 任务，通过 `POST /api/projects/:id/roles/:roleId/standard-reference` 进入与完整渲染共用的 IndexTTS 模型调度队列。任务元数据保存角色 ID，页面首次提交、服务重启接管和浏览器刷新恢复均可重新关联对应角色卡片。Worker 只读取 `character_assets.<roleId>.reference_audio.voice_id` 指向的原始上传 WAV，以角色专属试听文本和自然 1.05 或舒缓 1.18 时长系数生成候选。每轮最多尝试九次，仅从同时通过基础 WAV 质量、CAMPPlus 音色相似度和延迟回声代理的结果中按综合评分保留三版；不足三版时终止本次更新并保留原有标准候选。音色相似度门槛为 0.72，回声代理上限为 0.72。每次尝试的指标与通过状态写入任务 `result.json` 审计，失败音频随 staging 目录清理；永久 `voice-standard-*` 元数据和角色资产只登记合格候选。页面对历史数据也只显示通过全部门禁的候选，全部不合格时显示重新生成提示。

生成结果写入 `character_assets.<roleId>.standard_reference`，原始 `reference_audio` 和角色当前稳定音色保持不变。用户通过候选采用接口明确选择通过全部门禁的样本，服务端在工程锁内核对候选和文件，更新角色稳定音色，回填 `voice_files`，执行现有导演差异和成果物失效逻辑，再以临时文件原子替换 `project.json`。恢复接口执行同一保存流程并切回原始上传 `voice_id`。重新生成完成后只删除无任何工程引用且未选中的旧 `voice-standard-*` 文件；任务结束或取消时清理工程内的 `standard-reference-staging` 过程目录，Docker volumes 和其他永久音色不受影响。
