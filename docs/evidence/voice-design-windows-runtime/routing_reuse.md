# 导演路由与 VoiceDesign 模型复用

## 用户观察

完成一次角色音色生成后，再次点击生成时显存曲线出现阶跃增长。

## 证据分层

连续完成任务 `ab469b180a0a4ec981c1cbb0bffe010e`、`d1990fcedf0c4c68b339c79a24de5370`、`37aa217a5e5c43deb74ce3607b998c41` 和 `7dea9c75281641f7a2b9ff01b01c38f7` 均使用 runtime PID 23772，结果中的 `model_reused` 为 true。VoiceDesign 模型没有重新执行 `from_pretrained`。

每次音色任务原先都会无条件调用 Ollama `qwen3:8b` 重新计算 `guidance_routing`。该模型和 VoiceDesign 是两个独立模型，会造成额外显存变化和等待。

## 需求变更

音色任务在导演补充、路由模型和角色签名一致时复用 `document.guidance_routing`。任一输入变化时重新调用 Ollama。

## 修复结果

运行态任务 `60ace1d6fe0645ce87be9016b05f857a` 在所有角色保持现有音色时用 0.225 秒完成。新生成 0 个，保留 7 个，状态为“未调用模型”。VoiceDesign PID 前后均为 23772，启动时间不变，CPU 增量为 0。Ollama 前后活动模型数均为 0。
