# 证据索引

| 证据 | 位置 | 说明 |
|---|---|---|
| 原始任务结果 | `D:/workspace/IndexTTS-2.5/runtime-output/product-jobs/45256b9444fc467cb9cbea8dba7e412d/result.json` | 36 次候选指标和失败载荷 |
| 原始任务状态 | `D:/workspace/IndexTTS-2.5/runtime-output/product-jobs/45256b9444fc467cb9cbea8dba7e412d/status.json` | 页面截图对应的终态消息 |
| Worker 修复 | `voice_design_worker.py` | 部分合格交付、连续种子和分类计数 |
| 产品编排修复 | `product_voice_worker.py` | 缺口计算、累计尝试持久化和候选合并 |
| 回归测试 | `tests/test_voice_design_worker.py` | 部分交付、种子偏移、缺口补齐与旧标记守卫 |
| 字段持久化 | `product-studio/server/index.test.mjs`、`product-studio/src/characterVoiceProfile.test.ts` | Node 与 TypeScript 规范化合同 |
| 第一轮真实 GPU 任务 | `D:/workspace/IndexTTS-2.5/runtime-output/product-jobs/3c30e8bfd40a4821bc315e87ebe6e957` | 刘至诚完整候选、旁白 0 个及分类失败统计 |
| 第二轮真实 GPU 任务 | `D:/workspace/IndexTTS-2.5/runtime-output/product-jobs/56aaa5f215634f44b557d62e953a739d` | 仅处理旁白，Seed 偏移 36，部分合格 2 个进入工程 |
| 第三轮真实 GPU 任务 | `D:/workspace/IndexTTS-2.5/runtime-output/product-jobs/594f6a1ac0e246f4a747668adfb28e5f` | 仅补 1 个候选，Seed 114，工程最终补齐 |
| 当前工程状态 | `D:/workspace/IndexTTS-2.5/outputs/novel-projects/20260904043536-成都粉子-5b71f8/project.json` | 两个角色各 3 个候选，累计尝试与未补齐字段正确 |
| 浏览器截图 | `browser-acceptance.png` | 部署后角色资产页显示两个角色等待三选一 |
| 浏览器 Console | Browser Use `tab.dev.logs()` | 页面重新载入并进入角色资产页后返回空数组 |
