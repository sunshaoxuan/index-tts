# 命令记录

1. `node --test product-studio/server/chapterSections.test.mjs product-studio/server/index.test.mjs`
2. `.\.venv\Scripts\python.exe -m pytest tests/test_text_director.py -q`
3. `pnpm test`
4. `.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q`
5. `pnpm run build`
6. `git diff --check`
7. `docker inspect indextts25-product-studio`
8. 通过 Node 只读解析三个生产 `project.json`，计算分句数、旧章节文本数、正式标题数与规范后章节数。
9. 通过产品 GET 和 PUT 接口保存三个工程，再物理读取 `project.json` 核对 `segments`、`director_memory.segments` 与 `chapters`。
10. 浏览器打开白夜行01与白夜行03的分句导演，核对第一页章节文本、分句总数、Console，并保存截图。
11. `Invoke-RestMethod http://127.0.0.1:7864/api/health`
12. `git push fork master`
13. `git rev-parse HEAD`、`git rev-parse fork/master` 与 `git ls-remote fork refs/heads/master`
