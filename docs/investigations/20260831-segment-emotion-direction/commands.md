# 命令记录

1. `git status --short --branch`、`git diff --stat`、`git diff --check`
2. `pytest tests/test_text_director.py tests/test_product_render_worker.py tests/test_director_memory.py tests/test_novel_project.py -q`
3. Node 24 隔离容器内执行 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm build`
4. 使用 Node test name pattern 单独复现新增情绪测试和 worker 调度测试
5. 通过 `Dockerfile.app-update` 与基础镜像 `1.1.37` 构建隔离验收镜像
6. 在 `127.0.0.1:7865` 启动独立验收容器并创建最小 14 列工程
7. 应用内浏览器选择“坏笑着说”，填写细化描述，保存、刷新并回读
8. 应用内浏览器读取 warning 与 error 日志并保存截图
9. 删除隔离容器和验收镜像，复核 `127.0.0.1:7864/api/active-job`
10. 将提交 `db3cf88` 构建为 `indextts25-product-studio:1.1.38`
11. 活动任务和等待队列为空后，通过临时 Compose 覆盖重新创建 7864 容器
12. 发现 checkpoints 挂载来源不一致后恢复部署前五项挂载，并从运行验收起点复查
13. 检查 revision、源码 SHA256、GPU、双 Python、健康接口、项目列表、日志、RestartCount、正式页面、Console 和截图
