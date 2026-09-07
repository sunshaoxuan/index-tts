# 验证命令

```powershell
python -m pytest -q
```

```powershell
Set-Location product-studio
npm test
npm run build
```

```powershell
git diff --check
```

```powershell
docker ps --filter "name=indextts25-product-studio" --format "{{.Names}}|{{.Image}}|{{.Status}}"
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:7864/api/active-job"
```

浏览器验收通过 Codex CUA 对生产页面执行分页、单分句生成、无障碍树状态读取、候选 DOM 文本读取、控制台读取和截图检查。
