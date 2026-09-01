# 测试结果

| 项目 | 结果 | 证据 |
|---|---|---|
| 角色参考图聚焦接口测试 | 3 passed | 单张、全量、关联工程、顺序、旁白排除、缺图和拒绝降级 |
| Product Studio 全量测试 | 164 passed | 工作区 Node 直接执行 `node --test server/*.test.mjs src/*.test.ts` |
| 分镜 Python 回归 | 19 passed | `tests/test_storyboard_regeneration.py`、`tests/test_product_analysis_worker.py` |
| TypeScript 与 Vite 生产构建 | 通过 | 3108 modules transformed |
| Compose 配置 | 通过 | `docker compose config --quiet` |
| Docker 应用更新镜像 | 通过 | `indextts25-product-studio:1.1.61-storyboard-identity-final`，manifest `sha256:eb62a8e5614b0338fb3c550366565510ca323edc9ba9df4d3908fde4f7d9d8b1` |
| 隔离运行容器健康 | 通过 | `indextts25-storyboard-identity-acceptance` healthy，`/api/health` status ok |
| 桌面浏览器 | 通过 | 1280px，document scrollWidth 1265；已使用、缺资料、已就绪和“原始角色图约束容貌”均实际显示 |
| 移动浏览器 | 通过 | 390px，document scrollWidth 375；三种人物一致性状态均实际显示 |
| Console | 通过 | error 0，warning 0 |
| 真实外部 Images Edits | `evidence_missing` | 为避免未确认的图像输入和输出费用，本次未触发付费生成 |

Vite 报告一个既有的大体积 chunk 提示。该提示不影响本次类型检查、构建产物和运行页面。

首次直接调用 `pnpm test` 时，包脚本内的 `node` 未出现在当前 PowerShell PATH，命令没有进入测试执行。随后使用 Codex 工作区 Node 可执行文件直接运行同一 Node test glob，164 项全部通过。该环境差异已记录在 `commands.md`。
