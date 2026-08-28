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

交互验收地址为独立本地服务 `http://127.0.0.1:7865/`。最终复核时，`http://127.0.0.1:7864/` Docker 容器为 healthy，生产 bundle 包含“关联已有工程并导入角色音色”，`/api/projects` 的全部返回项包含 `roleCount`。
