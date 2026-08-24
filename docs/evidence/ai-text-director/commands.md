# 命令记录

## 静态和自动测试

```powershell
.\.venv\Scripts\python.exe -m py_compile production_webui.py text_director.py text_director_worker.py voice_design_worker.py
.\.venv\Scripts\python.exe -m pytest tests\test_novel_project.py tests\test_text_director.py tests\test_production_webui.py tests\test_windows_launcher.py tests\test_voice_design_worker.py tests\test_text_director_worker.py -q
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
git diff --check
```

## 正式运行

```powershell
.\scripts\start_indextts25_windows.ps1 `
  -Port 7863 `
  -AiBaseUrl http://127.0.0.1:11434 `
  -AiModel qwen3:8b `
  -AiTimeout 300 `
  -AiChunkChars 1400
```

## 运行验收

1. 打开 `http://127.0.0.1:7863/`。
2. 创建并重新打开 2 章节小说工程。
3. 提交真实小说样本，确认唯一旁白轨道、4 条最终角色和 7 条分句。
4. 新增内心独白角色，通过已知角色选择器校正心理活动和姓名误判。
5. 刷新永久音色库，试听并为两个相关轨道分配同一稳定音色 ID。
6. 添加全篇纠音规则并保存工程。
7. 真实生成完整音频、章节 WAV、角色轨道和分句 WAV，随后再次生成验证 7/7 缓存复用。
8. 使用 Python 检查 WAV 参数、JSON 原文与实际朗读文本、章节数量、ZIP 内容和 ZIP CRC。
9. 检查浏览器控制台并保存 `09-novel-project.png` 和 `10-novel-project-delivery.png`。
