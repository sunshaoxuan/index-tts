# 测试结果

## Python 针对性回归

命令：`.venv\\Scripts\\python.exe -m pytest tests/test_v2.py -k "qwen_emotion_convert" -q`

结果：`10 passed, 22 deselected`。

命令：`.venv\\Scripts\\python.exe -m pytest tests/test_text_director.py -k "accent_guidance or standard_generation_reports or advanced_generation_records or advanced_generation_uses_thirty" -q`

结果：`4 passed, 103 deselected`。

## Python 完整相关模块

命令：`.venv\\Scripts\\python.exe -m pytest tests/test_text_director.py tests/test_v2.py -q`

结果：`127 passed, 12 skipped`。跳过项为项目已有的显式 GPU 标记用例；本次新增的分类容错、口音门禁和标准候选审计均执行通过。

## Product Studio

命令：`pnpm test`

结果：`236 passed, 0 failed`。

命令：`pnpm run build`

结果：TypeScript 和 Vite 生产构建通过，转换 `3111 modules`。仅有既有的大 bundle 提示。

## Docker 与运行时

增量镜像 `indextts25-product-studio:1.1.94-212c3bc` 以生产镜像 `1.1.93-0a17911` 为基础构建。镜像标签 `org.opencontainers.image.revision` 为 `212c3bca06036699ee489d6ee4a1de19bdf3cfca`。

7864 容器重新创建后为 `running | healthy | RestartCount=0`。`GET /api/health` 返回 `status: ok`，`GET /api/active-job` 返回 `available: false`。

## 真实浏览器验收

在生产工程“成都粉子02”完成以下检查：

- 角色卡片直接显示当前口音或“标准口音”。
- 第 3 条显示“成都口音”误填警告，迁移按钮打开旁白角色资产并在首屏预填“成都口音”。
- 首次取消后，第 3 条仍保留“成都口音”。
- 再次迁移并应用后，第 3 条的误填内容清空，旁白标记为需要重新生成音色。
- 保存工程并刷新后，旁白角色卡片继续显示“成都口音”，第 3 条情绪细化保持为空。
- 未触发旁白音色生成，现有稳定音色保持不变。

Chrome DevTools 验收记录位于 `artifacts/segment-accent-guidance-fix/browser-acceptance.json`。桌面 `1280 x 900` 和手机 `390 x 844` 的页面横向溢出均为 `false`，可见越界元素均为 0，口音输入可见且值为“成都口音”，Console warning/error 为 0。截图分别为 `desktop-role-accent.png` 和 `mobile-role-accent.png`。
