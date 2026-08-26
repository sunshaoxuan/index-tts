# 验证命令

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_voice_design_daemon.py -vv --durations=10
.\.venv\Scripts\python.exe -m pytest tests\test_voice_design_worker.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_novel_project.py -q
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
node --test server\*.test.mjs src\*.test.ts
pnpm run build
git diff --check
git diff --cached --check
```

运行态验证使用 `http://127.0.0.1:7864/api/health`、`/api/active-job`、真实临时交付 DELETE 请求和浏览器页面检查。

最终复验先停止旧 Node PID 29108，再使用 Codex 内置 Node v24.19.0 启动 PID 8488。首次尝试因当前 PowerShell PATH 未包含 `node` 而失败，随后改用已核实的 Node 绝对路径恢复服务。7864 监听进程、健康接口、删除确认框与浏览器 Console 均重新检查。

提交前再次运行 Node 全量测试。`pnpm run build` 因其子进程 PATH 未包含 Node 而退出，随后直接使用同一 Node v24.19.0 调用项目内 `typescript/bin/tsc` 与 `vite/bin/vite.js`，生产构建成功。
