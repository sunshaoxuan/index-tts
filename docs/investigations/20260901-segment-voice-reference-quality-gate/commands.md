# 命令记录

## 调查

```text
git status --short --branch
git rev-parse HEAD
git rev-parse fork/master
docker inspect indextts25-product-studio
rg model.infer text_director.py indextts/infer_v2_5.py
measure_speaker_similarity.py
```

## 测试

```text
python -m pytest tests/test_text_director.py -q
uv run --frozen --extra test python -m pytest tests/test_text_director.py -q
node --test product-studio/server/*.test.mjs product-studio/src/*.test.ts
node product-studio/node_modules/vite/bin/vite.js build
```

系统默认 Python 3.12 缺少 pytest。随后使用 `uv.lock` 创建 Python 3.11 测试环境。系统 PATH 缺少 Node，随后使用 Codex 工作区依赖提供的 Node 24 可执行文件。
