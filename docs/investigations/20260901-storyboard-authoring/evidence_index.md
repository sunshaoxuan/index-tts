# 证据索引

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| 场景包含多个镜头 | `product-studio/src/App.tsx`，生产 DOM 显示 2 个场景和 5 个镜头 | 高 | 使用受控临时工程 |
| 20 分钟音频可形成约 120 个镜头 | `tests/test_storyboard_regeneration.py` 的 1200 秒字幕测试 | 高 | 自动化时间线 fixture |
| 镜头使用真实音频时间 | `storyboard_regeneration.py`，生产 DOM 显示 0.000 至 50.600 秒连续镜头 | 高 | 受控临时工程时间数据 |
| AI 全量重建入口存在 | 生产 DOM 中的“AI 重新生成全部分镜”按钮，`product-studio/server/index.mjs` | 高 | 未在用户正式工程触发 AI 请求 |
| 手工创建入口存在 | 生产 DOM 与“手工创建分镜镜头”弹窗 | 高 | 弹窗检查未保存用户数据 |
| 镜头拆分可用 | 生产 DOM 从 5 个镜头变为 6 个，第一镜头拆为 4.9 秒和 4.9 秒 | 高 | 受控临时工程，未保存 |
| 相邻多选缺陷已修复 | `toggleStoryboardShotSelection`、对应单元测试、隔离浏览器拆分后合并成功 | 高 | 使用与生产相同的镜像 |
| 单张与全量关键帧入口存在 | 生产 DOM 中的“生成这一张关键帧”和“生成全部 5 张关键帧” | 高 | 未调用外部图像服务，避免产生无关费用 |
| Product Studio 回归通过 | `pnpm test`，161 passed | 高 | Node 24 工作区运行时 |
| Python 应用回归通过 | 314 passed，30 subtests passed | 高 | 排除与当前 checkpoint 不匹配的 v1、v2 推理 fixture |
| 分镜与导演聚焦回归通过 | 97 passed | 高 | 聚焦测试集合 |
| 前端生产构建通过 | 3108 modules transformed | 高 | bundle 大小提示保留 |
| 生产容器健康 | image `sha256:a0aedebc7479...`，healthy，RestartCount 0 | 高 | revision 为工作树验收标识 |
| 桌面页面可见且无溢出 | `artifacts/storyboard-authoring-20260901/storyboard-desktop-panel.jpg`，1280×720，overflow false | 高 | 同镜像隔离实例 |
| 手工创建入口可见 | `artifacts/storyboard-authoring-20260901/storyboard-manual-create-modal.jpg` | 高 | 同镜像隔离实例 |
| 移动页面可见且无溢出 | `artifacts/storyboard-authoring-20260901/storyboard-mobile-390x844.jpg`，390×844，overflow false | 高 | 同镜像隔离实例 |
| Console 无异常 | 桌面与移动 `tab.dev.logs()` 均为 0 项 | 高 | 同镜像隔离实例 |
| 当前 7864 生产入口仍可见 | `artifacts/storyboard-authoring-20260901/storyboard-production-7864-current.png`，三个独立分镜操作入口、4 个场景镜头清单、1280×720 overflow false、Console 0 | 高 | 当前工程的分镜镜头尚未执行 AI 全量重建，页面显示 0 个镜头 |
