# 测试结果

## 聚焦测试

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_production_webui.py tests\test_windows_launcher.py -q
```

结果：33 项通过。

## 全量非 GPU 测试

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
```

结果：186 项通过，22 项按 GPU 标记跳过，30 个子测试通过。存在 3 条第三方弃用警告。

## 真实 AI

1. Ollama 模型：`qwen3:8b`。
2. 完整验收请求：输入 835 Token，输出 718 Token，耗时 82.2 秒。
3. 结果：4 条角色轨道，7 条分句，原文覆盖 100%。

## 真实 IndexTTS

1. AI VoiceDesign：4 个角色参考 WAV，可在页面试听。
2. 完整 WAV：22050 Hz，单声道，16.2 秒。
3. 逐句 WAV：7 个。
4. 角色轨道 WAV：4 个。
5. CSV：7 行。
6. ZIP：CRC 检查通过，共 14 个文件。
7. 浏览器控制台：0 条 error，0 条 warn。
