# 测试结果

## 聚焦测试

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_production_webui.py tests\test_windows_launcher.py tests\test_text_director_worker.py tests\test_voice_design_worker.py -q
```

结果：39 项通过。

## 全量非 GPU 测试

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
```

结果：192 项通过，22 项按 GPU 标记跳过，30 个子测试通过。存在 3 条第三方弃用警告。

## 真实 AI

1. Ollama 模型：`qwen3:8b`。
2. 完整验收请求：输入 835 Token，输出 718 Token，耗时 82.2 秒。
3. 结果：4 条角色轨道，7 条分句，原文覆盖 100%。

## 真实长文本 AI

1. 输入长度：2797 字。
2. 自然文本块：2 个。
3. 结果：4 条角色轨道，108 条分句，原文覆盖 100%。
4. Token：4042 输入，12613 输出。
5. AI 有效请求累计耗时：221.2 秒。
6. Ollama 冷启动：99.26 秒，模型 37/37 层运行于 GPU。
7. 浏览器 Console：0 条 error，0 条 warn。

## 覆盖校验恢复压力测试

1. 输入长度：706 字。
2. 内容特征：重复段落、编号、引号、菱形符号和零宽特殊字符。
3. 动态过程：初始 1 块，覆盖失败后依次扩展为 2、3、4 块。
4. 安全分段块：3 个。
5. 结果：3 条角色轨道，21 条分句，原文覆盖 100%。
6. 浏览器 Console：0 条 error，0 条 warn。

## 真实 IndexTTS

1. AI VoiceDesign：4 个角色参考 WAV，可在页面试听。
2. 完整 WAV：22050 Hz，单声道，16.2 秒。
3. 逐句 WAV：7 个。
4. 角色轨道 WAV：4 个。
5. CSV：7 行。
6. ZIP：CRC 检查通过，共 14 个文件。
7. 浏览器控制台：0 条 error，0 条 warn。
