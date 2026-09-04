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

部署、浏览器、Console、截图和 Git 交付命令在最终验收后补充。
