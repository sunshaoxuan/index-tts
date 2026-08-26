# 命令记录

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test product-studio/server/index.test.mjs
```

```powershell
$nodeExe = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $nodeExe --test <server and src test files>
& $nodeExe node_modules\typescript\bin\tsc -b
& $nodeExe node_modules\vite\bin\vite.js build
```

```powershell
& 'D:\workspace\IndexTTS-2.5\.venv\Scripts\python.exe' -m pytest -m 'not gpu' -q
```

产品服务使用 `scripts/start_indextts25_windows.ps1 -SkipBuild` 在 7864 端口重启，随后检查 `/api/health`、真实分句导演页面、控制台和截图。
