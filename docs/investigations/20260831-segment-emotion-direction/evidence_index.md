# 证据索引

| 结论 | 证据 | 可信度 | 限制 |
|---|---|---|---|
| 分句具有详细预设、细化描述和权重 | `product-studio/src/App.tsx`、`product-studio/server/index.mjs`、真实 7865 与 7864 页面截图 | 高 | 当前桌面视口范围 |
| `emo_text` 包含显式演绎与通用导演条件 | `text_director.py` 的 `segment_emotion_text`、`tests/test_text_director.py` FakeModel 调用断言 | 高 | 使用受控 FakeModel 审计参数，没有生成新的正式作品音频 |
| 权重传入 `emo_alpha` | `text_director.py` 推理调用与 FakeModel 的 `0.8` 断言 | 高 | 同上 |
| 旧 12 列工程兼容 | Python 与 Node 迁移测试 | 高 | fixture 覆盖读取和保存路径 |
| 情绪修改只使对应分句缓存失效 | `product-studio/server/index.test.mjs` 双分句专项测试 | 高 | 使用本地文件 fixture |
| 页面保存回读成功 | 7865 隔离工程 API 回读为 `sly_smile`、细化描述、`0.8` | 高 | 隔离工程已随临时容器删除 |
| 页面 Console 清洁 | 应用内浏览器日志筛选结果为空数组 | 高 | 当前验收会话范围 |
| UI 视觉布局通过 | `artifacts/segment-emotion-acceptance/segment-director-sly-smile-detail.png` | 高 | 桌面视口截图 |
| 正式 7864 任务未受影响 | 验收前后 `/api/active-job` 从 4.84% 推进到 49.92% | 高 | 时点状态会继续变化 |
| 正式 7864 已部署最终源码 | 镜像 `1.1.38`、revision 标签、容器与宿主源码 SHA256、生产截图 | 高 | 产品版本号继续使用现有 1.1.5 |
| 正式运行配置保持 | Docker inspect 的 GPU、网络、8 GiB、unless-stopped 和五项挂载 | 高 | checkpoints 来源曾在首次部署中不合格，修正后从起点复验 |
