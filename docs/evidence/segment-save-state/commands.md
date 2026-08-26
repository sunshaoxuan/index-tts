# 命令记录

```powershell
rg -n "zhao2|擦火柴点着" outputs/novel-projects -g 'project.json' -g 'segment-fragments.json'
```

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test src\segmentState.test.ts
```

```powershell
$nodeExe = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $nodeExe node_modules\typescript\bin\tsc -b
& $nodeExe node_modules\vite\bin\vite.js build
```

生产服务重启后检查 `/api/health` 和 JavaScript 静态资源 MIME，再通过浏览器执行编辑、状态检查、保存、刷新恢复、Console 和截图验证。
