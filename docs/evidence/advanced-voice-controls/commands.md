# 验证命令

## Python 全量非 GPU 测试

```powershell
uv run pytest -m "not gpu" -q
```

## Node 测试

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test server/*.test.mjs src/*.test.ts
```

## TypeScript 与生产构建

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" node_modules/typescript/bin/tsc -b
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" node_modules/vite/bin/vite.js build
```

## 真实年龄样本

```powershell
.\.venv-voice-design\Scripts\python.exe scripts\validate_voice_age_distinctiveness.py --output docs\evidence\advanced-voice-controls\age-samples
```

## 运行环境

```powershell
.\scripts\start_indextts25_windows.ps1 -SkipBuild
Invoke-RestMethod http://127.0.0.1:7864/api/health
```
