# 命令记录

## 静态和自动测试

```powershell
.\.venv\Scripts\python.exe -m py_compile production_webui.py text_director.py text_director_worker.py voice_design_worker.py
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_production_webui.py tests\test_windows_launcher.py tests\test_voice_design_worker.py tests\test_text_director_worker.py -q
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
git diff --check
```

## 正式运行

```powershell
.\scripts\start_indextts25_windows.ps1 `
  -Port 7862 `
  -AiBaseUrl http://127.0.0.1:11434 `
  -AiModel qwen3:8b `
  -AiTimeout 300 `
  -AiChunkChars 1400
```

## 运行验收

1. 打开 `http://127.0.0.1:7862/`。
2. 选择 AI 长篇导演和小说体。
3. 提交真实小说样本，确认 100% 原文覆盖、4 条角色轨道和 7 条分句。
4. 验证分析、音色设计和完整音频三个取消路径。
5. 使用 AI VoiceDesign 生成并试听 4 条角色音色。
6. 使用生成音色制作完整音频和分轨交付包。
7. 使用 Python 检查 WAV 参数、CSV 行数、JSON 音色映射、ZIP 内容和 ZIP CRC。
8. 检查浏览器控制台并保存关键全页截图。
