# VoiceDesign 长耗时加载与前端可观察性调查

## 用户问题

角色音色生成页面长期停留在 5%，页面只显示正在加载 VoiceDesign 模型，用户无法判断后台是否仍在工作。

## 行为链路

1. Product Studio 创建角色音色作业并写入 `runtime-output/product-jobs/<job-id>/input.json`。
2. 服务端启动 `product_voice_worker.py`，作业状态由 `status.json` 提供。
3. Voice Worker 使用专用解释器 `/opt/voice-venv/bin/python` 调用持久 VoiceDesign Runtime。
4. Runtime 首次加载约 4.21 GB 的 Qwen3 TTS 权重。加载期间模型尚不能报告候选生成比例，因此业务进度保持在 5%。
5. 服务端从 Worker PID、`/proc/<pid>/io`、`/proc/<pid>/status` 和 VoiceDesign Runtime 状态文件采集辅助遥测。
6. 前端在原进度信息下展示后台响应、运行时长、模型状态、RSS 内存、累计磁盘读取量和权重总量。

## 根因

原页面只显示业务阶段和业务完成比例。模型首次加载阶段缺少进程存活、资源读取和运行时心跳信息，所以持续工作的加载进程与失联进程在页面上呈现相同。

同时发现两个相关运行问题：

1. 专用虚拟环境入口曾被符号链接解析为系统 Python，造成 `qwen_tts` 环境门禁失败。`runtime_python.py` 现保留虚拟环境的绝对入口路径。
2. Windows 旧 Product Studio 与 Docker 容器曾同时监听 7864 并共用运行目录。旧进程已停止，当前 7864 由 Docker 容器独占。

## 已验证结果

真实作业 `d97f4d474aca45d1aadaa9aacb62ba7d` 已完成，生成音色 `voice-0c81cc4a13b887b9`。状态为 `complete`，模型保持驻留。生成输入和最终音色元数据均包含 `略带中国东北口音`。听感符合程度仍需要人工试听确认。

页面遥测在真实加载期间显示后台进程响应、运行时长、模型加载、内存和累计读取量。首次浏览器验收发现挂载文件的 `birthtime` 产生异常运行时长，开始时间已改用输入文件的 `mtime`，并增加 60 秒内开始时间的回归断言。

当前镜像 `indextts25-product-studio:1.1.0` 的容器健康，端口为 7864，重启策略为 `unless-stopped`。VoiceDesign 权重位于外部命名卷 `indextts25-qwen-voice-design-model`。

## 结论边界

前端现在能够说明后台是否工作以及权重读取是否推进。5% 仍表示模型加载阶段，辅助遥测负责解释该阶段的实际活动。双引擎升级到 `transformers==4.57.4` 与 `accelerate==1.12.0` 的隔离 GPU 推理验证尚未执行，属于后续独立验收项。
