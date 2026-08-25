# 测试结果

## 静态检查

`py_compile` 通过。

## Python 聚焦测试

11 passed，1 条第三方 librosa 弃用警告。

## Node 服务测试

10 passed。

## 非 GPU 回归

220 passed，22 deselected，30 subtests passed，3 条第三方弃用警告。

## 真实 GPU 运行

任务 `df4e88f2bfa44f09a47d2402f1f9ebf6` complete。新生成 2 个音色，保留 5 个音色。runtime PID 23772，模型保持驻留。

## 浏览器

页面显示热模型状态和两个新音色 ID。Console 0 error，0 warning。截图检查通过。

## 路由复用增量验证

聚焦测试 58 passed。非 GPU 回归 222 passed，22 deselected，30 subtests passed。

真实无变更任务 `60ace1d6fe0645ce87be9016b05f857a` 用 0.225 秒完成。VoiceDesign CPU 增量为 0，Ollama 前后活动模型数为 0。
