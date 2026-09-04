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

部署、浏览器、Console、截图和 Git 交付命令在最终验收后补充。
