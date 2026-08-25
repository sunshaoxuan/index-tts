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
2. 展开角色节奏和分句态度单元格。
3. 修改后确认出现未保存状态，恢复值并保存。
4. 验证桌面全页和 390 x 844 移动端。
5. 查询 Console error、warning。
