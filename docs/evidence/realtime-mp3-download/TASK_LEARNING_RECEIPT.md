# TASK LEARNING RECEIPT

task_type: 实时媒体格式转换与浏览器下载

reusable_pattern: 保存无损主文件，下载时由独立进程把编码 stdout 流式返回，并在客户端断开时终止进程。

failure_or_correction: Unicode 业务标识不能直接写入 Node HTTP header。下载文件名需要 ASCII fallback 配合 RFC 5987 filename*，真实中文标识必须进入回归测试。

candidate_skill: `D:\workspace\codex-selfimp\outputs\2026-08-26-realtime-mp3-download`

candidate_validator: 中文 Content-Disposition、媒体完整解码、持久副本计数和浏览器下载属性联合门禁。

install_status: candidate only

evidence_paths: `docs/evidence/realtime-mp3-download`
