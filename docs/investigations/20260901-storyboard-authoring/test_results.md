# 测试结果

## 自动化验证

| 检查 | 结果 |
|---|---|
| Product Studio | 161 passed |
| Python 应用回归 | 314 passed，30 subtests passed |
| 分镜与全文导演聚焦测试 | 97 passed |
| TypeScript 与 Vite 生产构建 | 通过，3108 modules transformed |
| Docker Compose 配置 | 通过 |
| Git diff check | 通过 |

`tests/test_v1.py` 和 `tests/test_v2.py` 使用与当前 checkpoint 不匹配的推理 fixture。包含它们的探查运行得到 327 passed、6 skipped、3 failed 和 16 errors。正式应用回归按项目既有命令排除这两个文件并通过。

## 生产运行

| 检查 | 结果 |
|---|---|
| 镜像 | `indextts25-product-studio:1.1.59-storyboard-working` |
| 镜像 ID | `sha256:a0aedebc7479fe3d6ceb91de3b6b76ab61055eb84824e75750693298fd35cca1` |
| revision | `working-tree-storyboard-shots-mergefix` |
| 容器健康 | healthy |
| RestartCount | 0 |
| API health | status ok，productVersion 1.1.5 |

## 浏览器验证

| 检查 | 结果 |
|---|---|
| 两层场景与镜头 DOM | 通过 |
| 目标镜头时长入口 | 通过 |
| AI 全量重建入口 | 通过 |
| 手工创建弹窗 | 通过 |
| 拆分实际交互 | 通过 |
| 同场景多选与合并 | 通过，拆分后勾选两项并合并回 5 个镜头 |
| Console error 与 warning | 通过，桌面与移动日志均为 0 项 |
| 桌面截图 | 通过，`storyboard-desktop-panel.jpg` |
| 390×844 移动截图 | 通过，`storyboard-mobile-390x844.jpg` |
| 手工创建弹窗截图 | 通过，`storyboard-manual-create-modal.jpg` |
| 页面横向溢出 | 通过，1280 与 390 视口均为 false |

生产 7864 的现有完整音频渲染任务未中断。返工浏览器验收使用同一镜像的 7865 隔离实例和独立工程目录。

SSD 模型卷切换并重新创建 7864 容器后，再次在当前生产实例只读检查视频分镜工作区。页面显示 AI 重新生成全部分镜、手工创建分镜镜头和生成全部 0 张关键帧三个独立入口，4 个场景均显示场景内镜头清单；1280×720 横向溢出为 false，Console error 与 warning 为 0。截图为 `storyboard-production-7864-current.png`。检查期间存在的分句 1 重新生成任务随后以 `complete` 结束，未由本次浏览器检查触发或中断。

首次复跑 `pnpm test` 时，当前 PowerShell PATH 中缺少 `node.exe`，测试在收集前停止。将工作区 Node 24 的绝对目录加入 PATH 后，Product Studio 161 项测试和 3108 模块生产构建通过。随后从仓库根目录执行正式 Python 应用回归，结果为 314 passed、30 subtests passed；另一次仅指定 `tests` 目录的探查运行得到 178 passed，该探查结果不作为正式全量回归数量。
