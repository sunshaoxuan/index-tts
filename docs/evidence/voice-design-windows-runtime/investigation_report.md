# VoiceDesign Windows 常驻进程故障调查

## 用户现象

点击生成角色音色后，页面持续显示 `<built-in function kill> returned a result with an exception set`。

## 根因

第一处故障位于 `voice_design_daemon_client.py`。代码使用 `os.kill(pid, 0)` 探测常驻进程 PID。Windows 将信号 0 作为无效参数处理，先返回 WinError 87，随后 Python 抛出 SystemError。原异常范围没有处理该分支。

第二处故障出现在修复存活探测后的真实冷启动。`.venv-voice-design` 先建立包装进程，再由实际解释器运行 daemon。包装进程 PID 与 `state.json` 中的实际 runtime PID 不同，旧代码要求两个 PID 相等，导致已经就绪的 daemon 被误判为 45 秒启动超时。

## 修复

Windows 存活探测改为 `OpenProcess`、`GetExitCodeProcess` 和 `STILL_ACTIVE`。非 Windows 平台继续使用 `os.kill(pid, 0)`。

冷启动验收改为检查实际 runtime 进程存活、协议版本和 `started_at` 属于本次启动，不再要求包装 PID 与 runtime PID 相等。

## 运行结果

真实工程 `20260825-104455-白夜行01-869866` 的任务 `df4e88f2bfa44f09a47d2402f1f9ebf6` 完成。新生成旁白和松野秀臣两个音色，保留其余五个音色。常驻模型 PID 23772，状态为 ready，`model_loaded` 为 true。

浏览器页面显示 `Voice Model Hot / 音色模型已驻留`。角色表显示新音色 `voice-60565d448665a82b` 和 `voice-1e35fd32062c7340`。浏览器 Console 中 error 和 warning 均为 0，已完成截图检查。
