# 命令记录

## 调查与差异

```powershell
git status --short
git log --oneline -5
rg -n "allKeyframesGenerating|storyboardKeyframeProgress|projectLocked" product-studio/src/App.tsx
git diff --check
```

## 测试与构建

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --experimental-strip-types src/storyboardKeyframeProgressUI.test.ts
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/typescript/bin/tsc -b
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vite/bin/vite.js build
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test server/*.test.mjs src/*.test.ts
& '.venv\Scripts\python.exe' -m pytest -q tests/test_storyboard_regeneration.py tests/test_product_analysis_worker.py tests/test_text_director.py
docker compose config --quiet
git diff --check
```

## 浏览器验收

隔离应用监听 `127.0.0.1:7877`，延迟图像 mock 监听 `127.0.0.1:47831`。浏览器使用真实白夜行01 工程的 3 镜头副本，逐次验证独立原文、取景证据、独立小记、角色参考状态、成功、第二张失败和主动取消。390 x 844 视口额外读取场景标题与标签矩形并确认 `overlap=false`。验收结束后停止两个监听并删除 `artifacts/storyboard-keyframe-progress-20260902/runtime` 临时目录。

白夜行01 第一场景 8 镜头使用本机 Ollama `qwen3:14b` 在内存副本中调用 `author_storyboard_shots()`，未保存生产 `project.json`。实跑得到 8/8 ID、8/8 当前镜头原文证据和 8/8 唯一小记。

## 环境差异

当前 PowerShell PATH 没有 Node。第一次聚焦测试命令未启动测试，随后改用 Codex 工作区 Node 的绝对路径。同一测试集合通过。

## Git 交付

```powershell
git commit -m "fix: ground storyboard shots in source text"
git fetch fork master
git merge-base --is-ancestor refs/remotes/fork/master HEAD
git push fork HEAD:master
git fetch fork master
git rev-parse HEAD
git rev-parse refs/remotes/fork/master
git ls-remote fork refs/heads/master
```

功能提交为 `4f1a76a608f5a03f23665104c595153cee712b64`。首次推送后本地 HEAD、跟踪引用和远端服务器 `master` 三方一致。交付回执提交推送后再次进行同一核验。
