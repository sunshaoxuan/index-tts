# 证据索引

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| IndexTTS 2.5 是官方最新版本 | 官方仓库 README 的 Latest release 与 2026-08-10 News | 高 | 以 2026-08-31 查询结果为准 |
| 情绪设置已进入推理 | `text_director.py` 的 `emo_text`、`emo_alpha` 调用与真实候选清单 | 高 | 情绪效果仍以用户试听为最终判断 |
| 引擎没有词级重音硬参数 | `indextts/infer_v2_5.py` 的 `infer` 参数和 GPT 生成参数校验 | 高 | 提示词只能提供概率增强 |
| 高级模式真实生成三份 WAV | 临时工程任务 `a86335add9e846fbb8db5c445bfab82e`，候选大小 154668、144428、153132 字节 | 高 | 首次三份重音代理均未达标，已触发停止条件返工 |
| 候选数据可审计并自动采用第一名 | `segment-fragments.json` 保存分数、`stress_db`、质量、代理结果、算法与采用项 | 高 | 文本比例对齐属于声学代理 |
| 抽卡未达阈值时继续尝试 | `test_advanced_stress_generation_keeps_drawing_until_three_proxy_verified_candidates` | 高 | 单元测试使用受控声学结果，真实九次预算返工后尚未重新部署 |
| 同序号草稿只显示最新缓存 | `returns three auditable segment candidates and adopts the user selection` | 高 | Node 注入测试，不依赖运行容器 |
| 移动端已有响应式稳定性修复 | `product-studio/src/styles.css` 与 `segmentRowLayout.test.ts` | 中 | 修复后的本地页面最终浏览器复测被 URL 策略阻止，标记 `evidence_missing` |
