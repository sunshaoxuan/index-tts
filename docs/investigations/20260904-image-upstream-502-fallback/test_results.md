# 测试结果

| 检查 | 结果 | 范围 |
|---|---|---|
| 定向 Node 测试 | 79 passed，0 failed | 图像路由、角色形象 API、前端 API 解析 |
| 全套 Node 测试 | 221 passed，0 failed | Product Studio 服务端与前端逻辑 |
| TypeScript | passed | `pnpm exec tsc --noEmit` |
| 生产构建 | passed | Vite 8.2.2，3110 modules transformed |
| Compose 配置 | passed | `docker compose config --quiet` |
| 差异格式 | passed | `git diff --check` |
| 镜像内生产构建 | passed | `1.1.84-09ba10b`，3110 modules transformed |
| 容器健康 | passed | healthy，RestartCount 0，revision `09ba10bc...` |
| 真实角色形象请求 | passed | `req-b` HTTP 200，40.161 秒 |
| 图片持久化 | passed | 2,078,881 字节 PNG，SHA256 `3509257DB2BB5801272054574C4AAF038FD60F0ECB077C1B14CDBEFE9B655F67` |
| 公网静态资源 | passed | Health、首页、bundle 和角色 PNG 均为 HTTP 200 |
| 公网 Edge | passed | v1.1.5，目标工程和保存状态命中，角色图 1122 x 1402 |
| 浏览器 Console | passed | error 0，warning 0，exception 0，failed resource 0 |

Vite 报告既有的大包体积提示，构建退出码为 0。本次修复没有增加新的前端依赖或页面模块。

初次截图只检查 `img` 元素存在，像素尚未解码而显示空白。该次验收判为不合格。验收器增加 `complete`、`naturalWidth` 和 `naturalHeight` 门禁后从完整浏览器流程起点重跑，最终截图显示真实人物像素。

最终清单再次重跑了 221 项测试、TypeScript、生产构建、Compose、容器、公网 Health、首页、bundle、PNG 和浏览器 DOM。CUA 的动态 role locator 在刷新后两次触发内部 3 秒超时，同一时刻 DOM 快照和 CSS 元素计数均确认图片存在。最终像素与 Console 结论采用稳定的独立 Edge CDP 结果，CUA 快照作为第二条页面证据。
