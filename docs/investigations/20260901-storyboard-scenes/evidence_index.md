# 证据索引

| 结论 | 证据位置 | 置信度 | 限制 |
|---|---|---|---|
| AI 已按视频分镜边界分析场景 | `text_director.py`、`tests/test_text_director.py` | 高 | 模型输出仍受兼容文本模型能力影响 |
| 场景音频时间来自真实 WAV 时长与句后停顿 | `product-studio/src/storyboard.ts`、`product-studio/src/storyboard.test.ts` | 高 | 需要完整交付 captions |
| 无音频时省略场景时间 | `buildSceneAudioRanges()` 空 captions 测试与隔离浏览器页面 | 高 | 历史工程需要重新分析才能获得新场景字段 |
| 关键帧支持九种风格及单张与全量重生成 | `product-studio/server/index.mjs`、`product-studio/server/index.test.mjs`、`product-studio/src/App.tsx` | 高 | 接口测试使用受控兼容图像服务响应 |
| 产品文档已同步 | `README.md`、`CHANGELOG.md`、`docs/NOVEL_PROJECT_REQUIREMENTS_zh.md` | 高 | 无 |
| 隔离桌面场景卡片验收通过 | `artifacts/storyboard-scenes-20260901/storyboard-desktop.png` | 高 | fixture 页面不调用外部图像模型 |
| 隔离移动场景卡片验收通过 | `artifacts/storyboard-scenes-20260901/storyboard-mobile-390x844.png` | 高 | fixture 页面不调用外部图像模型 |
| 生产桌面分镜页面通过 | `artifacts/storyboard-scenes-20260901/storyboard-production-panel-a44e59d.png` | 高 | 当前生产工程没有新格式场景 |
| 生产移动分镜页面通过 | `artifacts/storyboard-scenes-20260901/storyboard-production-mobile-390x844-a44e59d.png` | 高 | 当前生产工程没有新格式场景 |
| 生产容器运行本次镜像 | 镜像 `indextts25-product-studio:1.1.57-a44e59d`，revision `a44e59dc45c927ad3f1f229098d1cdb46341cd85` | 高 | 生产镜像包含功能提交与模型遥测提交 |
| 远端 master 接收本次交付 | `git rev-parse HEAD`、`git rev-parse fork/master`、`git ls-remote fork refs/heads/master` | 高 | 本轮文档提交后需要再次记录最终哈希 |
