# 命令记录

## 运行状态

```powershell
docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'
docker stats --no-stream indextts25-product-studio 503a8ee3bf42
docker top 503a8ee3bf42 -eo pid,ppid,stat,etime,pcpu,pmem,args
nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv,noheader
```

## 模型清单和迁移进度

```powershell
docker exec 503a8ee3bf42 sh -lc 'find /target -type f | wc -l; du -sb /target'
docker exec 503a8ee3bf42 sh -lc "find /source -path '/source/Qwen3-TTS-12Hz-1.7B-VoiceDesign' -prune -o -type f -print | wc -l"
```

## 静态检查和测试

```powershell
docker compose config --quiet
git diff --check
pnpm --dir product-studio test
.venv\Scripts\python.exe -m pytest tests\test_render_daemon.py
```

## 发布验收待执行

```powershell
$env:INDEXTTS_APP_REVISION='<commit>'
docker compose build studio
docker compose up -d --no-build --force-recreate studio
docker inspect indextts25-product-studio
```
