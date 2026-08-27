# Command Log

主要验证命令：

```text
pnpm test
pnpm build
.venv\Scripts\python.exe -m pytest tests\test_novel_project.py tests\test_character_assets.py -q
git diff --check
POST http://127.0.0.1:7865/api/projects
GET http://127.0.0.1:7865/api/projects/<created-id>
```

浏览器验收地址为 `http://127.0.0.1:7865/`。7864 的 Docker 重建因同机并行构建与大型依赖层竞争被中止，现有目标容器随后被其他并行流程停止；本次没有把 7864 作为运行证据。
