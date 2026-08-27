# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 主 Worker Python 入口失效 | 修复前容器 `ls` 和 Docker 日志中的 `spawn /app/.venv/bin/python ENOENT` | 高 | 对应故障镜像 |
| Node 因未处理 error 事件退出 | Docker 日志中的 `Unhandled 'error' event` 与连续服务重启 | 高 | 日志发生于故障时段 |
| 前端收到 HTML 后直接解析 JSON | 用户截图和修复前 `product-studio/src/api.ts` | 高 | 截图未显示具体 HTTP 状态 |
| 固定后的主环境有效 | 容器内输出 `/app/.venv /app/indextts/__init__.py` | 高 | 当前修复镜像 |
| VoiceDesign 环境有效 | 容器内输出 `/opt/voice-venv/.../qwen_tts/__init__.py` | 高 | 使用包定位，未重复执行 GPU 推理 |
| Worker spawn 失败返回 JSON 且服务存活 | `product-studio/server/index.test.mjs` 回归测试 | 高 | 使用受控 ENOENT 事件 |
| HTML 响应转为可理解错误 | `product-studio/src/api.test.ts` | 高 | 使用 502 HTML fixture |
| 真实音色任务完成 | 作业 `2c5376f24c1b4bb09ab658f6251512a7`、`0bd73ea964034a789fc9ac8059426454` | 高 | 当前角色无需新生成 |
| 浏览器页面恢复 | In-app Browser DOM、Console 和截图 | 高 | 当前截图为完成后的页面 |
