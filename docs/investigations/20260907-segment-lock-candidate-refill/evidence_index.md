# 证据索引

| 证据 | 位置 | 证明内容 |
| --- | --- | --- |
| 前端状态实现 | `product-studio/src/segmentRegenerationState.ts` | 单分句保存、提交、运行状态和目标行锁定判定 |
| 前端任务合并 | `product-studio/src/App.tsx` | 单分句完成只刷新音频结果，保留其他行编辑 |
| 候选生成实现 | `text_director.py` | 三十次预算、逐次门禁、异常继续、审计与失败摘要 |
| 前端单元测试 | `product-studio/src/segmentRegenerationState.test.ts` | 目标行锁定、其他行可编辑、保存竞态与终态合并 |
| Python 单元测试 | `tests/test_text_director.py` | 候选异常后补齐三份及三十次预算耗尽分支 |
| 生产任务 | `7ae9b66bd25d482ea53f9bd1bd532ff0` | 第 27 条真实高级三版生成完成 |
| 生产逐次审计 | `outputs/novel-projects/20260904043536-成都粉子-5b71f8/process/segment-attempt-audits/47cb97f9a47a1875f3c5de81dd62884bca6539d1826d2da70203b5c81a461df1.json` | 十五次尝试、三次通过、十二次音色身份失败 |
| 浏览器运行态截图 | 当前 Codex 任务中的 CUA 截图 | 第 27 行锁定、第 28 行可编辑、`6/30，1/3` 进度 |
| 浏览器完成态截图 | 当前 Codex 任务中的 CUA 截图 | 第 27 条三份候选全部显示并通过音色门禁 |
| 浏览器控制台 | 当前 Codex 任务中的 CUA `dev.logs()` 输出 | 返回空数组，错误和警告均为零 |

截图已经在真实生产页面 `http://127.0.0.1:7864/?acceptance=segment-lock-refill-7f419d9` 中完成检查。CUA 截图作为当前任务内证据呈现，浏览器安全策略不允许把截图数据 URL 再打开为可下载页面，因此本次没有生成重复的本地截图文件。
