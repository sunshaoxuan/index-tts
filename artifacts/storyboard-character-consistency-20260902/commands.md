# 命令记录

## 调查

```powershell
git status --short --branch
git remote -v
rg -n "sceneKeyframePrompt|generateSceneKeyframe|images/generations|character_assets|portrait_url|participants|keyframe" product-studio/server/index.mjs product-studio/server/index.test.mjs product-studio/src/api.ts product-studio/src/App.tsx
```

## 测试与构建

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test server/*.test.mjs src/*.test.ts
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\typescript\bin\tsc' -b
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\vite\bin\vite.js' build
.venv\Scripts\python.exe -m pytest -q tests/test_storyboard_regeneration.py tests/test_product_analysis_worker.py
docker compose config --quiet
docker build --file Dockerfile.app-update --build-arg BASE_IMAGE=indextts25-product-studio:1.1.60-6330c1b --build-arg APP_REVISION=storyboard-character-identity-final -t indextts25-product-studio:1.1.61-storyboard-identity-final .
```

## 运行时验收

```powershell
docker run -d --name indextts25-storyboard-identity-acceptance -p 7865:7864 ... indextts25-product-studio:1.1.61-storyboard-identity-working
Invoke-RestMethod http://127.0.0.1:7865/api/health
```

浏览器检查地址为 `http://127.0.0.1:7865/`。检查视频分镜页的已使用参考图、资料缺失、人物一致性已就绪、“原始角色图约束容貌”、缺图门禁、桌面和移动端横向溢出、Console error 和 warning。

## 已处理的环境差异

初次执行 `pnpm test` 时，包脚本内的 `node` 未出现在当前 PowerShell PATH，测试尚未启动。随后使用 Codex 工作区 Node 可执行文件直接运行相同测试集合并完成全部测试。第一次聚焦测试发现一处测试正则文字顺序与实际错误消息不一致，修改断言后聚焦测试和全量测试均通过，产品代码无需为该失败返工。
