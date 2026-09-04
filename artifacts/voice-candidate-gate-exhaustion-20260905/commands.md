# 命令记录

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_voice_design_worker.py -q
pnpm test
pnpm run build
.\.venv\Scripts\python.exe -m pytest -m "not gpu" --basetemp=.codex-tmp\v\full -q
```

发布、运行时和 Git 远端核验命令将在执行后追加。

```powershell
git push fork master
docker build -f Dockerfile.app-update --build-arg BASE_IMAGE=indextts25-product-studio:1.1.84-09ba10b --build-arg APP_REVISION=7540492b846894a0ce982a0f29de551a30ae4482 -t indextts25-product-studio:1.1.85-7540492 .
docker image inspect indextts25-product-studio:1.1.85-7540492
```

```powershell
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{}' -Uri 'http://127.0.0.1:7864/api/projects/20260904043536-%E6%88%90%E9%83%BD%E7%B2%89%E5%AD%90-5b71f8/voices'
Invoke-RestMethod -Uri 'http://127.0.0.1:7864/api/jobs/<job-id>'
Invoke-RestMethod -Uri 'http://127.0.0.1:7864/api/health'
docker ps --filter name=indextts25-product-studio
git rev-parse HEAD
git rev-parse fork/master
git ls-remote fork refs/heads/master
```

真实 GPU 任务号依次为 `3c30e8bfd40a4821bc315e87ebe6e957`、`56aaa5f215634f44b557d62e953a739d`、`594f6a1ac0e246f4a747668adfb28e5f`。
