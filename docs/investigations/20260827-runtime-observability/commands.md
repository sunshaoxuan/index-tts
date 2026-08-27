# 命令记录

## 运行状态

```powershell
docker compose ps
docker image inspect indextts25-product-studio:1.1.0 --format '{{.Id}} {{.Size}}'
```

## 代码与证据定位

```powershell
rg -n "telemetry|startedAt|job-progress-observation" product-studio
rg -n "略带中国东北口音" runtime-output outputs -g '*.json'
rg -n "restart:|qwen-voice-design-model" compose.yaml
```

## 测试与构建

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_runtime_python.py
pnpm --dir product-studio test
pnpm --dir product-studio build
docker compose config --quiet
git diff --check
```

## 浏览器验收

```text
打开 http://localhost:7864/
读取可见 DOM
读取 warning 和 error 级别 Console 日志
截取当前可见页面
```
