# 命令记录

## 静态与单元验证

```powershell
& 'D:\nginx\runtime\node\pnpm.cmd' test
& 'D:\nginx\runtime\node\node.exe' --check server\index.mjs
& 'D:\nginx\runtime\node\node.exe' --check server\model-job-scheduler.mjs
& 'D:\nginx\runtime\node\pnpm.cmd' exec tsc -b --pretty false
& 'D:\nginx\runtime\node\pnpm.cmd' exec vite build --outDir ..\.codex-task\long-operation-cancel\dist --emptyOutDir
& 'D:\nginx\runtime\node\pnpm.cmd' build
git diff --check
```

## 浏览器验收

隔离服务地址为 `http://127.0.0.1:47890/`，模拟上游地址为 `http://127.0.0.1:47891/`。验收完成后两个监听均已停止。浏览器检查使用全新标签页，从磁盘工程重新加载后执行全量关键帧，等待第一张完成和第二张开始，再执行取消。
