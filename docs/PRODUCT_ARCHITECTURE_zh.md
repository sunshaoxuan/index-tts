# Index Voice Studio 产品架构

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

## 数据边界

Node 保存前校验作品体裁、角色类型、角色节奏、重新生成选项、语言、态度、情绪、句内节奏和纠音规则。高级音色提示允许自然语言，并进入音色签名。旧工程中的自然语言有限控制值在读取时确定性迁移为最接近的中文枚举。工程使用临时文件加原子重命名保存。

三个 Python Worker 共享单任务互斥门，避免 Ollama、Qwen3 TTS 和 IndexTTS 同时抢占 GPU。Worker 异常与启动失败都会写入终态，前端不会永久停在加载阶段。

任务启动时，Node 在写入 Worker 输入前登记 `activeJob`，其中包含 `jobId`、任务类型和 `projectId`，并持久写入 `runtime-output/product-jobs/active-job.json`。Worker 启动后追加 PID。`GET /api/active-job` 合并活动标记与实时 `status.json`，供刷新后的 React 页面自动选择所属工程、恢复相同进度面板和继续轮询。同一工程在任务存续期间的 PUT 保存返回 409。前端同步禁用工程选择、全文、角色、分句、纠音、新建和保存操作。任务完成或失败后删除活动标记、释放锁并重新载入工程结果。

Node 服务恢复时读取持久活动标记并探测 Worker PID。进程仍存活时恢复活动锁和查询接口。进程不存在时把任务状态写成 error，说明原 Worker 已终止，随后删除活动标记并释放工程锁。该设计避免浏览器刷新丢失等待状态，也避免服务重启后展示无法继续推进的僵尸任务。

角色字段中的 `profile` 定义为基于原文证据的人物小传，`voice_hint` 定义为声音导演建议。AI Schema 保持两字段稳定，提示词要求分别覆盖人物身份关系和可听声音特征。跨文本块合并时，信息更丰富且不是姓名占位的字段可以更新先前结果。安全回退使用可审计的“信息不足”小传和中性声音建议，不伪装成充分的人物理解。

VoiceDesign 最终指令由作品体裁、只应用于当前角色的全局导演上下文、角色类型和名称、人物小传、声音导演建议、角色节奏和干声约束组成。角色编辑窗口使用 `/api/presets` 暴露的音色与节奏展开文本，在浏览器中同步预览同一契约。名字占位的旧工程在 Node 读取规范化阶段迁移为待补充小传和 `中性清晰` 预设。

## 视觉系统

页面执行 ORYZO AI 暖暗产品编辑规范。Walnut Shadow 作为全页画布，Warm Cream 作为主要文字，Bark Brown 作为唯一填充操作面，Cork Border 用于虚线结构分隔，Ember 只用于短编辑性强调。页面使用全宽布局、紧行距展示标题、下划线输入、药丸按钮、透明卡片和零投影。

首屏使用 `hero-voice-workbench.png` 摄影产品图与 HTML 排版叠加。滚动进度映射到背景模糊、亮度、缩放、首屏文字模糊和透明度。工作区覆盖进入后，摄影背景保持固定并达到完整模糊。工作区使用 Bark Brown 半透明阅读层随内容上滑，内部卡片和表格保持透明。

顶部功能导航使用首屏绝对定位，随首屏一起离开视口。工作区以独立 100vh 分区从视口顶部进入，桌面端保留 102px 顶部安全距离，移动端保留 88px。该结构消除固定导航与工程内容共享同一层级造成的文字重叠。

Workspace、Voices、Director、Delivery 菜单控制 Ant Design Tabs 的 `activeKey`，并把页面滚动到工程区域。角色表和分句表使用表格内部横向滚动，页面根节点保持无横向溢出。

运行中任务使用固定前景进度面板。面板采用 Bark Brown 高不透明表面、Warm Cream 边界和 10px 高进度轨道，在 0% 时显示最小活动填充，同时明确显示工程版本锁定状态。

角色表通过 `/api/voices/:voiceId/audio` 提供行内音色试听。`voice_*.wav` 解析到 `examples`，`voice-*` 与 `legacy-*` 解析到永久音色库。接口限制文件名模式并支持 `Accept-Ranges`、206 和 `Content-Range`，用于拖动定位。

Ant Design Select 的弹层和虚拟列表使用 `overscroll-behavior-y: contain`。Ant Design 6 的列表容器采用 `overflow: hidden` 和自定义 wheel 处理，页面同时观察弹层生命周期：菜单打开时为 `html` 添加 `select-popup-open` 并暂停底层页面滚动，关闭时立即恢复。边界 wheel 处理继续作为兼容保护。

角色轨道表只展示角色身份、人物小传摘要、声音导演方案、音色试听和编辑入口。详细编辑使用两栏人物导演窗口，右侧列出生成依据和最终指令。移动端改为单栏并限制所有表单控件宽度，窗口只提供纵向滚动。

## 旧架构处置

旧 Gradio 产品页面和对应 UI 测试已经删除。Windows 产品启动入口只启动 Node 服务。Python 不再渲染产品页面。

产品固定使用专用端口 7864。启动器发现端口已被占用时会终止占用进程，再启动当前版本，不再通过参数切换产品端口。
