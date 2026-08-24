# 测试结果

## 聚焦测试

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_production_webui.py tests\test_windows_launcher.py -q
```

结果：25 项通过。

## 全量非 GPU 测试

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
```

结果：178 项通过，22 项按 GPU 标记跳过，30 个子测试通过。存在 3 条第三方弃用警告。

## 真实 AI

1. Ollama 模型：`qwen3:14b`。
2. 最终请求：输入 845 Token，输出 711 Token，耗时 11.0 秒。
3. 结果：4 条角色轨道，7 条分句，原文覆盖 100%。

## 真实 IndexTTS

1. 完整 WAV：22050 Hz，单声道，16 bit，484580 帧，21.976 秒。
2. 逐句 WAV：7 个。
3. 角色轨道 WAV：4 个。
4. CSV：7 行。
5. ZIP：CRC 检查通过，包含完整 WAV、7 个逐句 WAV、4 个角色轨道、CSV 和 JSON。
6. 浏览器控制台：0 条 error，0 条 warn。
