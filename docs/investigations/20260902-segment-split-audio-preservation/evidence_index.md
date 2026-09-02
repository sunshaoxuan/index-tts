# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 当前真实工程在连续生成期间执行了两次拆分 | `project.json` 的最近导演历史与 `runtime-output/product-jobs` 最近任务状态 | 高 | 用户数据只读核对 |
| 拆分让已有下一句保留旧序号并后移 | 最近三份导演历史快照中分句 14 至 18 的文本顺序 | 高 | 历史快照证据 |
| 接口读取阶段会按序号提前丢弃过程片断 | `product-studio/server/index.mjs` 的 `latestDraftByOrder` | 高 | 代码证据 |
| 现有回归遗漏接口读取阶段 | `product-studio/server/index.test.mjs` 仅直接调用 `reconcileFragmentsToProject` | 高 | 测试覆盖证据 |
| 部署接口同时返回同历史序号的两个不同文本片断 | 临时验收工程 `latest-render` 返回当前序号 15、16，两条音频均为 HTTP 200 | 高 | 临时工程已按清理规则删除 |
| 真实页面同时保留当前句和后一句播放器 | `artifacts/segment-split-audio-preservation/runtime-acceptance.png` | 高 | 使用真实 WAV 的受控验收工程 |
| 后一句音频实际可播放 | 浏览器媒体状态：两条 `readyState=4`，后一句播放进度推进至 0.49 秒，无媒体错误 | 高 | 未进行人工听感评价 |
| 页面运行无浏览器异常 | 浏览器 Console warning 0、error 0 | 高 | 当前镜像与当前页面 |
