# Index Voice Studio Windows 产品运行说明

## 产品架构

当前产品入口已经全面迁移为以下结构：

1. React 19.2.8 负责产品页面和状态管理。
2. Ant Design 6.6.1 提供 Table、Select、InputNumber、Tabs、Progress 和可访问交互。
3. Vite 8.2.2 负责 TypeScript 生产构建。
4. Node.js 24.19.0 LTS 与 Fastify 5.12.1 提供工程 API、枚举校验、静态页面和任务编排。
5. Python Worker 只负责 Ollama 文本导演、Qwen3 TTS VoiceDesign 和 IndexTTS 2.5 推理。

旧的 Gradio 产品页面已经移除。官方模型推理代码和 Python Worker 继续保留。

## 启动

```powershell
.\scripts\start_indextts25_windows.ps1
```

本机地址：`http://127.0.0.1:7864/`。当前局域网地址：`http://192.168.20.54:7864/`。启动器会先终止占用 7864 的进程，再在 `0.0.0.0` 上启动当前产品版本。端口不提供运行时切换。Windows 防火墙入站规则应允许 TCP 7864，并把远程地址限制为 `LocalSubnet`。

启动脚本要求 Node.js 24 LTS。系统找不到 Node 时可以设置：

```powershell
$env:INDEXTTS_NODE = "C:\Program Files\nodejs\node.exe"
$env:INDEXTTS_PNPM = "C:\Users\Administrator\AppData\Roaming\npm\pnpm.cmd"
```

## 前端构建和测试

```powershell
Set-Location .\product-studio
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## 产品功能

1. 新建声音工程，选择小说、新闻或故事体，粘贴整篇原文并保存导演补充。
2. 角色类型、音色模式、角色节奏和重新生成标记使用原生下拉单元格。
3. 分句角色、语言、态度、八类情绪和句内节奏使用原生下拉单元格。
4. 分句表切换到第二页及后续页面后仍按显示序号修改目标句。角色变更会同步角色 ID 与显示名称，保存工程并刷新页面后保持一致。
5. 重新执行 AI 全文分析后，招牌名称、术语和标题等句内短引用会保留在完整旁白句中。带说话动作或句末语气标点的引号内容仍按人物对白分轨。
6. 分句导演支持勾选连续两条或多条合并，也支持勾选一条后在原文光标位置拆分。结构调整后必须保存工程。
7. 情绪强度和句后停顿使用受限数值单元格。
8. VoiceDesign 原生自然语言能力通过“高级自定义提示”单独输入。
9. AI 全文分析、角色音色设计和完整音频渲染由 Node 创建独立 Python Worker 任务。
10. 最近一次完整音频、分轨包和导演清单可以直接预览或下载。
11. 全篇纠音规则、角色补充、旧工程枚举迁移和 GPU 任务互斥。
12. 任务运行时弹出高对比前景进度面板，并锁定当前工程的所有编辑入口；任务结束后自动恢复。
13. 角色表的音色 ID 单元格提供微型播放器，可直接播放、暂停和拖动进度。
14. 枚举下拉菜单使用独立滚动边界，菜单滚动不会带动页面。
15. 运行中任务刷新页面后会自动回到任务所属工程，恢复同一进度与只读锁。活动作业标记位于 `runtime-output/product-jobs/active-job.json`，正常终态自动清理。
16. 角色轨道显示人物小传完整度和声音导演方案。点击“编辑人物与音色”可修改人物身份、小传、音色模式、声音提示、角色节奏和重新生成设置，并查看最终 VoiceDesign 指令。
17. 角色表达节奏与下次生成处理上下排列。验收时应选择完整的“沉稳舒缓，重音清晰，短语间自然停连”长标签，确认选择框、开关和状态说明没有覆盖。
18. 生成角色音色前会显示“正在用 AI 分配导演补充的角色影响范围”。角色编辑窗口的“AI 语义分配”和“本角色有效补充”会显示模型、目标轨道和理由；等待路由或过期的补充不会进入音色指令。
19. 明确女性或男性的角色会显示声音性别硬约束。生成结果经过基频校验后才注册为永久音色；连续三次明显错配会显示错误并保留原音色。

AI 重新分析全文后，人物小传与声音导演建议会随角色一起进入工程。标记为“待补充”的角色表示原文证据或安全回退信息不足，建议补充后打开“重新生成并建立新签名”。

如果服务本身在任务期间被重启，启动时会检查原 Worker PID。原 Worker 存活时继续显示等待状态；原 Worker 已终止时，任务进入明确错误终态并允许重新启动。

## 视觉系统

页面使用用户提供的暖暗产品编辑风格：Walnut Shadow `#100904` 画布、Warm Cream `#ffedd7` 前景、Bark Brown `#382416` 表面、Cork Border `#40372e` 虚线结构和 Ember `#dc5000` 稀缺文字强调。页面没有投影，输入使用下划线形态，按钮使用药丸和幽灵轮廓形态。

首屏为全视口摄影声音工作台。向下滚动时背景连续模糊和压暗，带 Bark Brown 半透明阅读层的工作区从下方进入。内部卡片和表格继续透明。顶部功能导航随首屏离开，工程控制区通过自身顶部安全距离与视口边缘分离，因此导航文字不会压住工作区内容。

右上角菜单对应 Workspace、Voices、Director、Delivery 四个工作区。移动端隐藏首屏导航，工作区仍保留 88px 顶部空间，宽表格在表格内部横向滚动。

## 目录

1. `product-studio/src`：React 和 Ant Design 前端。
2. `product-studio/server`：Fastify API 和 Node 测试。
3. `product_analysis_worker.py`：AI 长文本导演 Worker。
4. `product_voice_worker.py`：角色音色设计 Worker。
5. `product_render_worker.py`：完整音频与分轨 Worker。
6. `outputs/novel-projects`：版本化小说工程。
7. `runtime-output/product-jobs`：任务状态、结果和日志。
