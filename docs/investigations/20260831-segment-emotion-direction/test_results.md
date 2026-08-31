# 测试结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| Python 渲染与工程迁移 | 通过 | 87 passed，0 failed |
| Product Studio 全量测试 | 通过 | 129 passed，0 failed |
| TypeScript 与 Vite 构建 | 通过 | 3104 modules transformed，构建退出码 0 |
| 预设自动权重 | 通过 | “坏笑着说”选择后显示 0.80 |
| 自定义描述组合 | 通过 | 页面显示英文预设与中文细化描述组合 |
| 保存和刷新回读 | 通过 | API 返回 `sly_smile`、细化描述、0.8，导演记忆为 2 次 |
| 空片断按钮 | 通过 | 页面显示“生成本分句” |
| 缓存局部失效 | 通过 | 第一条缓存删除，第二条缓存保留，页面仅保留第二条有效片断 |
| Console | 通过 | warning 0，error 0 |
| 截图 | 通过 | `artifacts/segment-emotion-acceptance/segment-director-sly-smile-detail.png` |
| 正式镜像 revision | 通过 | `1.1.38` 标签为 `db3cf88785336abd29c5457838477c3eabf06282` |
| 宿主与容器源码 | 通过 | `text_director.py` 与 `server/index.mjs` SHA256 分别一致 |
| 正式容器运行能力 | 通过 | healthy，RTX 5070 Ti，双 Python 环境，RestartCount 0 |
| 正式容器配置 | 通过 | 默认网络、8 GiB、unless-stopped、部署前五项挂载已恢复 |
| 正式 7864 浏览器 | 通过 | 249 条分句加载，情绪控件与既有片断按钮可见，Console 0 warning 和 0 error |
| 正式 7864 截图 | 通过 | `artifacts/segment-emotion-acceptance/production-1.1.38-segment-director.png` |

Vite 报告单个 JS chunk 大于 1100 kB。该提示属于现有包体积告警，不影响本次构建和交互验收。
