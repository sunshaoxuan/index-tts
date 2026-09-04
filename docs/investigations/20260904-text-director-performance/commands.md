# Commands

1. `Invoke-RestMethod http://127.0.0.1:7864/api/active-job`
2. `Invoke-RestMethod http://127.0.0.1:7864/api/jobs/4caad3449bee4d82b0495b7fca7d02ef`
3. `docker logs --since 40m ollama`
4. `docker exec ollama ollama ps`
5. `pytest tests/test_text_director.py -q`
6. `pytest tests/test_product_analysis_worker.py tests/test_text_director.py tests/test_text_director_worker.py tests/test_novel_project.py -q`
7. `pnpm test`
8. `pnpm build`
9. `git diff --check`
10. `pytest -m "not gpu" -q`
11. `Invoke-RestMethod http://127.0.0.1:7864/api/jobs/7266224af1914c17ad44ec93c2517a63`
12. `pytest tests/test_text_director.py -q`
13. 使用当前工作树 `OllamaTextDirector`、`qwen3:14b`、8192 context、300 字符预拆分和 staged analysis 对《成都粉子》执行只读完整基准，并运行人物小批次复核。
14. `pytest tests/test_product_analysis_worker.py tests/test_text_director.py tests/test_text_director_worker.py tests/test_novel_project.py -q`
15. `pytest -m "not gpu" -q`
16. 在 `product-studio` 执行 `pnpm test`
17. 在 `product-studio` 执行 `pnpm build`

18. 构建并部署 `indextts25-product-studio:1.1.80-1353715`，容器 revision 固定为 `13537153c4d8eb2c37e94958bacc7e4fcdab98b6`。
19. 在 7864 对《成都粉子》运行生产任务 `f0e52ec0479c40f5bb846391c42bbb8a`，读取任务 API、持久化结果和阶段 metrics。
20. `docker ps --filter "publish=7864"`、`docker inspect <container>`、`docker exec ollama ollama ps`。
21. 使用 Computer Use 打开生产页，检查角色资产 5、分句导演 60、关键角色归属、Console 日志和角色页及分句页截图。
22. `git diff --check`。

23. 仅暂存五份调查文档，`git diff --cached --check` 通过，提交为 `80bb9f8ef13dd289a5c44bd3ba66ea296e9ebc96`。
24. `git push fork master:master` 成功。
25. `git fetch fork master`、`git rev-parse master`、`git rev-parse refs/remotes/fork/master` 和 `git ls-remote fork refs/heads/master` 均得到 `80bb9f8ef13dd289a5c44bd3ba66ea296e9ebc96`。
26. `git merge-base --is-ancestor 13537153c4d8eb2c37e94958bacc7e4fcdab98b6 master` 返回 0，确认 Compose revision 被交付分支包含。
27. 再次检查 7864 为 HTTP 200、容器 healthy、Ollama `qwen3:14b` 为 8192 context 和 100% GPU。
28. 读取生产任务 `f0e52ec0479c40f5bb846391c42bbb8a` 的模型文档与工程角色资产，确认模型旁白为 `male`、basis 为 `unknown`，角色资产旁白为 `unspecified`。
29. 执行 `pytest tests/test_text_director.py tests/test_product_analysis_worker.py tests/test_character_assets.py -q`，126 passed。
30. 执行 `pytest -m "not gpu" -q`，362 passed、22 deselected、30 subtests passed。
31. 在 `product-studio` 执行 `pnpm test`，216 passed。
32. 在 `product-studio` 执行 `pnpm build`，3110 modules transformed。
33. 部署 `indextts25-product-studio:1.1.81-0d3503e` 后运行任务 `2f13433c45aa409d9f82351c4fad60e1`，复现 `age_basis` issue 被误判为年龄值未修改。
34. 执行 `.venv\Scripts\python.exe -m pytest tests/test_product_analysis_worker.py tests/test_text_director.py tests/test_text_director_worker.py tests/test_novel_project.py tests/test_character_assets.py -q`，137 passed。
35. 执行 `.venv\Scripts\python.exe -m pytest -m "not gpu" -q`，363 passed、22 deselected、30 subtests passed。
36. 在 `product-studio` 执行 `pnpm test`，216 passed。
37. 构建并部署 `indextts25-product-studio:1.1.82-31dc7f4`，容器 revision 固定为 `31dc7f469284d7a90e101d06968edee2c99f28fa`。
38. 在 7864 对《成都粉子》运行最终任务 `6566f3ff96fa4ba0acd00bfa680ef030`，读取任务 API、持久化工程、阶段 metrics 和原文覆盖。
39. 使用 Computer Use 检查生产角色资产页、Console 和桌面截图，确认旁白显示“男性 · AI文章推断”。
