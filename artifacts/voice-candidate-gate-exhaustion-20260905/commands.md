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
