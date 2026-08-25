# 验收命令

## 依赖锁

```powershell
uv lock
```

## Node 测试与构建

```powershell
Set-Location product-studio
pnpm test
pnpm build
```

## Python 检查

```powershell
.\.venv\Scripts\python.exe -m py_compile product_analysis_worker.py product_voice_worker.py product_render_worker.py text_director.py novel_project.py
.\.venv\Scripts\python.exe -m pytest tests\test_novel_project.py tests\test_text_director.py tests\test_voice_design_worker.py tests\test_text_director_worker.py tests\test_windows_launcher.py -q
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
```

## 正式启动

```powershell
.\scripts\start_indextts25_windows.ps1 -SkipBuild
Invoke-RestMethod http://127.0.0.1:7864/api/health
```

## 浏览器验收

1. 打开 `http://127.0.0.1:7864/`。
2. 在首屏分别点击 Workspace、Voices、Director、Delivery，确认切换目标标签并滚动到工程区域。
3. 在首屏、过渡位置和工作区位置检查背景模糊连续变化，并确认工作区计算背景透明。
4. 在桌面工作区测量导航和工程控制区矩形，确认没有相交。
5. 展开角色节奏和分句态度单元格，确认枚举实际可选。
6. 确认角色表和分句表使用表内横向滚动。
7. 验证桌面全页和 390 x 844 移动端，检查文字重叠和页面横向溢出。
8. 查询 Console error、warning。
9. 在有原文的真实工程点击 AI 重新分析全文，确认 POST 返回 202、三个文本块到达 complete，并执行原文覆盖校验。
10. 任务运行时检查全文、角色、分句、纠音、工程选择和保存全部禁用；向同一工程发送 PUT 并确认 409。
11. 任务终态后确认前景进度面板收起、编辑控件恢复、同一 PUT 返回 200。
12. 在角色表播放音色，拖动到中段，确认当前时间变化；暂停后确认位置保持。
13. 展开可滚动枚举菜单，在菜单顶部和底部继续滚动，确认页面 `scrollY` 不变；关闭菜单后确认页面滚动恢复。
14. 启动真实音色任务，记录 `/api/active-job` 的任务 ID、工程、阶段和 PID，刷新页面，确认同一工程、同一任务进度面板与只读锁恢复。
15. 在 390 x 844 视口重复运行中刷新，确认进度面板完整、工程选择禁用且页面无横向溢出。
16. 等待任务终态，确认 `/api/active-job` 返回 `available: false`、面板收起和编辑恢复。
17. 打开角色与音色，检查姓名占位角色显示待补充小传和可靠预设，点击“编辑人物与音色”。
18. 修改人物小传，切换高级自定义，填写声线、共鸣和情绪底色，打开重新生成，确认最终 VoiceDesign 指令实时同步。
19. 检查全局导演上下文只应用与当前角色相关的要求，旁白指令不出现重复名称。
20. 在 390 x 844 视口检查编辑窗口只有纵向滚动，窗口和页面 `scrollWidth` 不超过各自 `clientWidth`。
21. 选择“沉稳舒缓 · 沉稳舒缓，重音清晰，短语间自然停连”，在 1280 x 720、820 x 900、390 x 844 三档视口测量节奏 Select 与下次生成处理矩形，确认不相交并保存截图 34、35、36。
22. 运行角色音色任务，记录 `routing_guidance` 阶段和 `document.guidance_routing`，逐项核对 `source_text`、目标角色 ID、名称、指令和理由。
23. 使用“笹垣说话更疲惫。经营烤乌贼饼摊位的女性声音更温和。”执行只读 AI 路由，确认分别分配到 role_001 与 role_002。
24. 对明确女性和男性的生成音色读取 `median_pitch_hz`、`expected_gender`、`gender_verified`，确认非旁白元数据不含旁白导演条件。

## 最终静态与端口检查

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_windows_launcher.py -q
git diff --check
Get-NetTCPConnection -LocalPort 7861,7862,7863,7864 -State Listen
```

## 第 103 行跨页角色修改修复

```powershell
Set-Location D:\workspace\IndexTTS-2.5\product-studio
pnpm test
pnpm build

Set-Location D:\workspace\IndexTTS-2.5
.\.venv\Scripts\python.exe -m pytest tests\test_novel_project.py tests\test_text_director_worker.py tests\test_text_director.py tests\test_voice_design_worker.py tests\test_windows_launcher.py -q
.\.venv\Scripts\python.exe -m py_compile text_director.py novel_project.py product_analysis_worker.py product_voice_worker.py voice_design_worker.py
git diff --check
.\scripts\start_indextts25_windows.ps1 -SkipBuild
Invoke-RestMethod http://127.0.0.1:7864/api/health
Invoke-RestMethod http://127.0.0.1:7864/api/active-job
Invoke-RestMethod http://127.0.0.1:7864/api/projects/20260825-104455-白夜行01-869866
```
