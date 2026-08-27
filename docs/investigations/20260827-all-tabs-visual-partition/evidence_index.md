# 证据索引

正式截图位于 `artifacts/all-tabs-visual-partition/final/`。

* `desktop/`：六页签、分句双层行、行间对比、全局设置和角色编辑。
* `narrow/`：六页签和分句行间对比。
* `mobile/`：六页签、两列多行页签导航和分句行间对比。
* `pagination/50-per-page.png`：分页数量运行态证据。
* `final/*/segments-readable-type.jpg`：桌面、窄屏和移动端字号与对比度修正证据。
* `final/*/delivery-player-contained.jpg`：桌面、窄屏和移动端播放器时间与进度条边界证据。
* `final/*/delivery-caption-emphasis.jpg`：桌面、窄屏和移动端当前字幕 12px 角色、16px 正文及手机单列排版证据。

代码证据为 `App.tsx`、`styles.css`、`segmentPagination.ts` 及三个专项测试文件。

当前字幕突出效果的代码与契约证据为 `styles.css`、`deliveryCaptionEmphasis.test.ts` 和 `delivery_caption_emphasis.md`。运行证据包括拖动定位到第 91 条、播放推进到第 97 条、标准动态验收捕获到 0.4 秒缩放动画、最终减少动态效果环境下动画关闭、三视口宽度测量、Docker 健康检查和 Console 空数组。
