# 最终验收回执

| 原始需求 | 成果物 | 证据 | 状态 |
|---|---|---|---|
| 全部已生成片断一起载入并可按分断调整 | latest-render fragments、分句表试听列、现有全部编辑控件 | API 测试、DOM、截图、双重匹配返工测试 | 合格 |
| 单独重生成某分断 | regenerate API、`force_segment_orders`、行内按钮 | 服务接口测试、FakeModel 强制生成测试、浏览器按钮 | 合格 |
| 重生成应用纠音并可编辑文字 | 保存后启动、`apply_pronunciations`、合成文字编辑框 | manifest 测试、页面 DOM | 合格 |
| 使用最新片断串接完整音频 | cache-only assemble、交付区按钮 | 单元测试与真实缺失片断门禁 | 合格 |
| 无问题片断不重复生成 | 内容哈希缓存复用 | 第二次渲染模型 0 次调用测试 | 合格 |
| 保留分句导演操作 | 服务端 `director_history` 与 `director_memory` | PUT 接口测试与工程类型 | 合格 |
| 稿件调整后学习并重应用断句和角色 | sequence-boundary-alignment、角色稳定映射、报告 | 4 个 memory 测试与 worker 集成 | 合格 |
| 合并、拆分、编辑或参数变化使受影响片断失效删除 | PUT 变化比较、索引移除、缓存 WAV 删除 | Node 测试、真实第 4 条音频 1 变 0、缓存文件不存在 | 合格 |
| 连续编辑时保留失效决策 | `.stale.json` 累积失效键 | 恢复原文后行内音频仍为 0、回归测试 | 合格 |
| 既有完整音频保留并标记过期 | `.stale.json`、latest-render stale 字段、过期警告 | WAV 34,986,518 字节，三个 HTTP 200，`03-stale-complete-delivery.jpg` | 合格 |
| 完整交付删除由用户决定 | Popconfirm 确认删除入口 | 真实页面出现“确认删除”与“取消”，验收选择取消 | 合格 |
| UI、控制台、截图 | 7864 真实页面 | Console 0 warning/error，浏览器截图 | 合格 |
| 真实 GPU 单句生成与纠音应用 | 第 4 条草稿片断 | 任务 `3df53959b0a14137822361fa5feef056`、约 3.91 秒、已应用纠音“笹垣” | 合格 |

原始需求和追加失效需求的功能、运行、页面、Console、截图、文件和交付链接验收均通过。音质的主观偏好由用户在可播放片断上试听决定。
