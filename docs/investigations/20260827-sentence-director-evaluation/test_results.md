# 测试结果

## 调查开始时的相关测试

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_director_memory.py tests\test_novel_project.py -q
```

结果：`64 passed in 0.34s`

覆盖范围：Schema 校验、原文完整性、引号拆分、确定性回退、导演记忆重应用、分句表往返。

未覆盖范围：真实小说分句边界质量、角色归属准确率、别名合并、场景边界、态度与节奏一致性、强度和停顿人工金标准、模型质量成本延迟比较。

## 报告完成后的最终重跑

结果：`64 passed in 0.25s`

退出码：`0`

结论：本轮调查文档生成后，相关测试集继续全部通过。
