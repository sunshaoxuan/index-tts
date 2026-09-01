# 命令记录

## 仓库与远端

```text
git status --short --branch
git worktree list --porcelain
git remote -v
git log --oneline --decorate -8 --all
git diff --check
git rev-parse HEAD
git rev-parse fork/master
git ls-remote fork refs/heads/master
```

## 测试与构建

```text
.venv\Scripts\python.exe -m pytest -q --ignore=tests/test_v1.py --ignore=tests/test_v2.py
.venv\Scripts\python.exe -m pytest -q tests/test_text_director.py tests/test_render_daemon.py
pnpm test
pnpm build
docker compose config --quiet
```

## 生产验收

```text
docker ps --filter name=indextts25-product-studio
docker inspect indextts25-product-studio
docker image inspect indextts25-product-studio:1.1.57-a44e59d
Invoke-RestMethod http://127.0.0.1:7864/api/health
Invoke-WebRequest http://127.0.0.1:7864/
Invoke-WebRequest http://127.0.0.1:7864/assets/index-BcnxMsaE.js
Invoke-WebRequest http://127.0.0.1:7864/assets/index-Dk2ucjVh.css
```

浏览器验收使用生产页面 `http://127.0.0.1:7864/?acceptance=storyboard-a44e59d` 和隔离 fixture `http://127.0.0.1:7865/?acceptance=2`。检查项目包括 DOM、桌面与移动尺寸、横向溢出、Console 和截图。
