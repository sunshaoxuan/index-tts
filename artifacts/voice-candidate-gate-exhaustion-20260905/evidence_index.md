# 证据索引

| 证据 | 位置 | 说明 |
|---|---|---|
| 原始任务结果 | `D:/workspace/IndexTTS-2.5/runtime-output/product-jobs/45256b9444fc467cb9cbea8dba7e412d/result.json` | 36 次候选指标和失败载荷 |
| 原始任务状态 | `D:/workspace/IndexTTS-2.5/runtime-output/product-jobs/45256b9444fc467cb9cbea8dba7e412d/status.json` | 页面截图对应的终态消息 |
| Worker 修复 | `voice_design_worker.py` | 部分合格交付、连续种子和分类计数 |
| 产品编排修复 | `product_voice_worker.py` | 缺口计算、累计尝试持久化和候选合并 |
| 回归测试 | `tests/test_voice_design_worker.py` | 部分交付、种子偏移、缺口补齐与旧标记守卫 |
| 字段持久化 | `product-studio/server/index.test.mjs`、`product-studio/src/characterVoiceProfile.test.ts` | Node 与 TypeScript 规范化合同 |
| 浏览器截图 | `browser-acceptance.png` | 部署后页面验收，待生成 |
