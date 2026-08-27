# 调查命令记录

## 1. 仓库与运行态

```powershell
git status --short
git branch --show-current
git log -5 --oneline
```

## 2. 代码调用链

```powershell
rg -n "migrate_attitude_preset|chunk|pace|attitude|_match_context_speaker" text_director.py
```

## 3. 工程数据

```powershell
rg --files "outputs/novel-projects/20260825-104455-白夜行01-869866"
```

工程 JSON 的统计通过 PowerShell `ConvertFrom-Json` 在内存中完成，没有另存小说正文或 API 凭据。

## 4. 测试

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_director_memory.py tests\test_novel_project.py -q
```

## 5. 安全说明

报告与命令记录不包含 API Key。外部 Endpoint 只执行模型发现，本轮没有发送小说正文。

## 6. 实施验证命令

```powershell
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
pnpm --dir product-studio test
pnpm --dir product-studio run build
.\scripts\start_indextts25_windows.ps1 -SkipBuild
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7864/api/settings/ai-media/director-test
```

页面验收使用内置浏览器访问 `http://127.0.0.1:7864/`，依次检查全局 AI 设置、角色删除确认和场景分析页，并读取 Console。
