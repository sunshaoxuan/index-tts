# 测试结果

| 项目 | 结果 | 证据 |
|---|---|---|
| 移动端场景卡聚焦测试 | 6 passed | 进度、锁定、镜头原文、证据、响应式标题与标签分行 |
| Product Studio 全量测试 | 187 passed | `node --test --experimental-strip-types server/*.test.mjs src/*.test.ts` |
| Python 分镜与文本导演回归 | 101 passed | `test_storyboard_regeneration.py`、`test_product_analysis_worker.py`、`test_text_director.py` |
| TypeScript | 通过 | `tsc -b` |
| Vite 生产构建 | 通过 | 3109 modules transformed |
| Compose 配置 | 通过 | `docker compose config --quiet` |
| Git 差异格式 | 通过 | `git diff --check` |
| 桌面进行中 | 通过 | 0/3、1/3、2/3，锁定控件，当前镜头与 ETA |
| 桌面完成 | 通过 | 3/3、100%，自动解除锁定 |
| 桌面失败 | 通过 | 当前构建第 2 张返回 503，1/3 保留，图片计数 `[1,0,0]`，自动解除锁定 |
| 主动取消 | 通过 | 当前构建全量生成进入 cancelled 并解除锁定；2.6 秒后 mock 请求总数保持 1，未继续提交后续镜头 |
| 移动端 | 通过 | 390 x 844，标题与标签 `overlap=false`，document 375/375，无横向溢出 |
| Console | 通过 | error 0、warning 0 |
| 白夜行镜头小记真实模型实跑 | 通过 | 本机 `qwen3:14b`，8/8 ID、8/8 当前镜头证据、8/8 唯一小记，2 requests，177.218 秒 |
| 真实外部图像生成 | `evidence_missing` | 未触发付费 Images Edits 或 Images Generations |

Vite 输出一个既有的大体积 chunk 提示。构建产物完整生成，该提示不影响本次验收。
