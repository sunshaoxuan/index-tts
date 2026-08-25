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

## 最终静态与端口检查

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_windows_launcher.py -q
git diff --check
Get-NetTCPConnection -LocalPort 7861,7862,7863,7864 -State Listen
```
