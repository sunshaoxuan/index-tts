# 命令记录

| 阶段 | 命令或检查 | 结果 |
|---|---|---|
| 仓库状态 | `git status --short --branch`、`git log -5 --oneline` | 当前为 detached HEAD `72f24ec`，仅有既存未跟踪成果目录 |
| 运行状态 | `/api/health`、`/api/active-job`、`docker ps` | 服务可达，无活动任务，容器 healthy |
| 真实工程 | `/api/projects`、工程导演历史、过程片断索引 | 确认连续生成、两次拆分及序号漂移 |
| 代码路径 | 搜索 `regenerateSegment`、`latest-render`、`reconcileFragmentsToProject` | 根因位于过程片断读取的序号提前去重 |
| 首次聚焦测试 | `node --test ...` | PowerShell 当前 `PATH` 无 `node`，测试未启动 |
| 修正后聚焦测试 | 使用 Codex Node 24 绝对路径执行两个目标测试 | 2 项通过 |
| 全量测试 | `pnpm test` | 166 项通过，0 失败 |
| 生产构建 | `pnpm build` | TypeScript 与 Vite 通过，3108 modules transformed |
| 功能提交 | `git commit`、`git push fork HEAD:master` | `8cbdb7d` 已推送，远程 `master` 等值 |
| 首轮镜像 | `docker build -f Dockerfile.app-update ...` | `1.1.62-8cbdb7d` 构建成功，revision 正确 |
| 容器替换 | 任务专属 Compose override 与 `--no-build --force-recreate` | running、healthy、RestartCount 0 |
| 运行接口 | 临时同序号冲突工程的 `latest-render` 与两条 WAV | 当前序号 15、16 同时返回，两条音频 HTTP 200 |
| 浏览器 | 分句导演 DOM、媒体状态、Console、截图 | 两个播放器同时保留，后一句可播放，无 Console 问题 |
| 清理 | `DELETE /api/projects/codex-segment-split-acceptance` | 临时工程已删除，原有 4 个工程保持存在 |
