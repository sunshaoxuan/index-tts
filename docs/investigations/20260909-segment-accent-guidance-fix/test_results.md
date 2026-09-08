# 测试结果

## Python 针对性回归

命令：`.venv\\Scripts\\python.exe -m pytest tests/test_v2.py -k "qwen_emotion_convert" -q`

结果：`10 passed, 22 deselected`。

命令：`.venv\\Scripts\\python.exe -m pytest tests/test_text_director.py -k "accent_guidance or standard_generation_reports or advanced_generation_records or advanced_generation_uses_thirty" -q`

结果：`4 passed, 103 deselected`。

## Python 完整相关模块

命令：`.venv\\Scripts\\python.exe -m pytest tests/test_text_director.py tests/test_v2.py -q`

结果：`127 passed, 12 skipped`。跳过项为项目已有的显式 GPU 标记用例；本次新增的分类容错、口音门禁和标准候选审计均执行通过。

## Product Studio

命令：`pnpm test`

结果：`236 passed, 0 failed`。

命令：`pnpm run build`

结果：TypeScript 和 Vite 生产构建通过，转换 `3111 modules`。仅有既有的大 bundle 提示。
