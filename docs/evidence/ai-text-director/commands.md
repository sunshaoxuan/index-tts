# 命令记录

## 静态和自动测试

```powershell
.\.venv\Scripts\python.exe -m py_compile production_webui.py text_director.py
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_production_webui.py tests\test_windows_launcher.py -q
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
git diff --check
```

## 正式运行

```powershell
.\scripts\start_indextts25_windows.ps1 `
  -Port 7862 `
  -AiBaseUrl http://127.0.0.1:11434 `
  -AiModel qwen3:14b `
  -AiTimeout 300 `
  -AiChunkChars 3600
```

## 运行验收

1. 打开 `http://127.0.0.1:7862/`。
2. 选择 AI 长篇导演和小说体。
3. 提交真实小说样本，确认 100% 原文覆盖、4 条角色轨道和 7 条分句。
4. 把李明音色修改为 `voice_04.wav`。
5. 生成完整音频和分轨交付包。
6. 使用 Python 检查 WAV 参数、CSV 行数、JSON 音色映射、ZIP 内容和 ZIP CRC。
7. 检查浏览器控制台并保存两张全页截图。
