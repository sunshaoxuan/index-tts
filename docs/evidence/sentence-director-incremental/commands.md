# 命令记录

- `pnpm test`
- `pnpm build`
- `.venv\Scripts\python.exe -m pytest tests\test_director_memory.py tests\test_novel_project.py tests\test_text_director.py tests\test_product_render_worker.py -q`
- `.venv\Scripts\python.exe -m pytest -m "not gpu" -q`
- `.venv\Scripts\python.exe -m py_compile product_analysis_worker.py product_render_worker.py director_memory.py novel_project.py`
- `git diff --check`
- `GET http://127.0.0.1:7864/api/health`
- 浏览器检查分句导演、完整交付、控制台和截图
- 真实点击“串接全部已生成片断”并检查任务错误与交付目录
- 真实页面编辑第 4 条合成文字、保存、恢复原文并再保存
- 检查片断缓存删除、`.stale.json`、完整音频字节数和三个交付 HTTP 状态
- 点击完整交付删除入口，确认弹层内同时存在“确认删除”和“取消”，然后取消
- `tab.dev.logs({levels:["error","warning"]})`
