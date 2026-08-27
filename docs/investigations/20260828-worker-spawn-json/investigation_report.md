# 音色生成 HTML 响应与 Worker 启动失败调查

## 用户现象

生成音色时页面提示 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`。

## 根因链路

1. Compose 为主 Worker 指定 `/app/.venv/bin/python`。
2. 镜像中的该入口仍指向构建阶段的 uv Python 路径 `/root/.local/share/uv/python/.../python3.11`，运行镜像中不存在该路径。
3. 音色生成、分句重生成等请求调用主 Worker 时发生 `spawn /app/.venv/bin/python ENOENT`。
4. 服务端在 `spawn()` 之后先执行异步文件写入，随后才注册 `error` 监听器。ENOENT 事件在监听器注册前触发，Node 抛出未处理事件并退出。
5. Docker 按 `unless-stopped` 重启容器。浏览器请求在重启窗口收到 HTML 页面，前端直接调用 `response.json()`，最终暴露 JSON 解析器错误。

## 修复

1. Dockerfile 将主虚拟环境入口固定到运行镜像中的 `/usr/local/bin/python3.11`，构建阶段验证 `sys.prefix == '/app/.venv'`。
2. Dockerfile 正式加入 SoX，并验证可执行文件。
3. 服务端在任何异步操作前注册 Worker 的 `spawn`、`error` 和 `close` 监听。真实 Worker 未成功触发 `spawn` 时，接口返回 JSON 错误并保持服务存活。
4. 前端先读取原始响应，根据 Content-Type 和内容决定是否解析 JSON。HTML 与其他非 JSON 响应转换为可理解的服务错误。
5. 容器启动时扫描全部持久作业，将重启前仍处于非终态的作业写为明确错误终态。

## 真实运行结果

修复镜像 ID 为 `sha256:187b7ba893465f02bff72e995b1cd354884d9e126ac38dee3763e532d7155f77`。容器健康且重启次数为 0。

API 作业 `2c5376f24c1b4bb09ab658f6251512a7` 和浏览器作业 `0bd73ea964034a789fc9ac8059426454` 均完成。当前工程已有 8 个有效音色且生成签名没有变化，因此两次作业均保留现有音色并未调用模型。该结果验证了主 Worker 启动、音色任务路由、作业轮询和 JSON 返回链路。历史作业 `d97f4d474aca45d1aadaa9aacb62ba7d` 已验证实际 Qwen GPU 生成。

## 结论边界

本次失败源于主 Worker 可执行文件缺失和未处理的 Node 子进程事件。当前工程没有产生新的 Qwen 候选，因为角色生成签名未变化。下一次用户修改角色音色参数后，任务将进入实际 Qwen 加载和生成阶段。
