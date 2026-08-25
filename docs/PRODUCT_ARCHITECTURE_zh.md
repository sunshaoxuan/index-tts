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
11. `GET /api/projects/:id/latest-render`

## 数据边界

Node 保存前校验作品体裁、角色类型、角色节奏、重新生成选项、语言、态度、情绪、句内节奏和纠音规则。高级音色提示允许自然语言，并进入音色签名。旧工程中的自然语言有限控制值在读取时确定性迁移为最接近的中文枚举。工程使用临时文件加原子重命名保存。

三个 Python Worker 共享单任务互斥门，避免 Ollama、Qwen3 TTS 和 IndexTTS 同时抢占 GPU。Worker 异常与启动失败都会写入终态，前端不会永久停在加载阶段。

任务启动时，Node 在写入 Worker 输入前登记 `activeJob`，其中包含 `jobId`、任务类型和 `projectId`。同一工程在任务存续期间的 PUT 保存返回 409。前端同步禁用工程选择、全文、角色、分句、纠音、新建和保存操作。任务完成或失败后释放锁并重新载入工程结果。

## 视觉系统

页面执行 ORYZO AI 暖暗产品编辑规范。Walnut Shadow 作为全页画布，Warm Cream 作为主要文字，Bark Brown 作为唯一填充操作面，Cork Border 用于虚线结构分隔，Ember 只用于短编辑性强调。页面使用全宽布局、紧行距展示标题、下划线输入、药丸按钮、透明卡片和零投影。

首屏使用 `hero-voice-workbench.png` 摄影产品图与 HTML 排版叠加。滚动进度映射到背景模糊、亮度、缩放、首屏文字模糊和透明度。工作区覆盖进入后，摄影背景保持固定并达到完整模糊。工作区使用 Bark Brown 半透明阅读层随内容上滑，内部卡片和表格保持透明。

顶部功能导航使用首屏绝对定位，随首屏一起离开视口。工作区以独立 100vh 分区从视口顶部进入，桌面端保留 102px 顶部安全距离，移动端保留 88px。该结构消除固定导航与工程内容共享同一层级造成的文字重叠。

Workspace、Voices、Director、Delivery 菜单控制 Ant Design Tabs 的 `activeKey`，并把页面滚动到工程区域。角色表和分句表使用表格内部横向滚动，页面根节点保持无横向溢出。

运行中任务使用固定前景进度面板。面板采用 Bark Brown 高不透明表面、Warm Cream 边界和 10px 高进度轨道，在 0% 时显示最小活动填充，同时明确显示工程版本锁定状态。

## 旧架构处置

旧 Gradio 产品页面和对应 UI 测试已经删除。Windows 产品启动入口只启动 Node 服务。Python 不再渲染产品页面。

产品固定使用专用端口 7864。启动器发现端口已被占用时会终止占用进程，再启动当前版本，不再通过参数切换产品端口。
