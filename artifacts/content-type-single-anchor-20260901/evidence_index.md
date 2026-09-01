# 证据索引

| 结论 | 证据 | 等级 |
| --- | --- | --- |
| 体裁先于人物分析 | `text_director.py` 的 `_classify_content_type` 与 `analyze_document` | 高 |
| 新闻评论固定唯一主播 | `text_director.py` 的 `_enforce_single_anchor_result`，`product_analysis_worker.py` 的 `prepare_single_anchor_analysis` 与 `enforce_single_anchor_tables` | 高 |
| 新闻评论跳过人物人口属性和小传校验 | `product_analysis_worker.py` 的 `single_anchor` 分支与真实工程 `character_validation.round_count=0` | 高 |
| 自动与人工体裁可保存 | `product-studio/server/index.mjs` 的枚举、缺省值和校验 | 高 |
| UI 显示体裁入口与说明 | `product-studio/src/App.tsx` 与 `screenshots/content-type-options.png` | 高 |
| 新建工程默认自动识别 | `screenshots/new-project-auto-default.png` | 高 |
| 主播特征可人工设置 | `screenshots/single-anchor-manual-settings.png` | 高 |
| 真实 Qwen 分析只有一个主播且覆盖完整 | `investigation_report.md` 的真实运行验收表 | 高 |
