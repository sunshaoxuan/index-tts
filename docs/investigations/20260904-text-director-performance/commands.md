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

最终文档提交、`git push fork master:master` 和本地、远程、Compose 提交包含关系在交付后记录。
