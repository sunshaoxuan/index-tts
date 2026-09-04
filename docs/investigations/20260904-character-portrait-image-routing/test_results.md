# 测试结果

## 代码与构建

| 检查 | 结果 |
|---|---|
| Product Studio 测试 | 219 项通过 |
| TypeScript | 通过 |
| Vite 生产构建 | 通过，3,110 modules transformed |
| `git diff --check` | 通过 |
| `docker compose config --quiet` | 通过 |
| Docker 增量镜像构建 | 通过 |

## 部署

| 检查 | 结果 |
|---|---|
| 镜像 | `indextts25-product-studio:1.1.83-719278a` |
| revision | `719278a9a24bcea56382e885aaf9d52147b006b8` |
| 容器健康 | healthy |
| RestartCount | 0 |
| `/api/health` | HTTP 200，`status=ok` |
| 首页与 bundle | HTTP 200 |

## 真实生成

| 检查 | 结果 |
|---|---|
| 原始角色按钮路径 | 已执行 |
| Gemini 接口路由 | 已进入 Chat Completions |
| Gemini 供应商状态 | HTTP 503，无可用账户 |
| 互补模型自动切换 | 已切换 `gpt-image-2` |
| 最终角色形象请求 | HTTP 200 |
| 图片资源 | HTTP 200，PNG，1,883,816 字节 |
| 页面图片 | 已显示 |
| 应用并保存工程 | 通过 |
| Console | 0 error，0 warning |
| 截图检查 | 通过，旁白卡片完整显示生成图片 |

