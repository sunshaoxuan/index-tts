# 最终验收回执

## 初衷级验收清单

| 验收项 | 成果 | 证据 | 状态 |
|---|---|---|---|
| 章节显示为简短编号 | 统一为“第 N 章” | Node 和 Python 定向测试 | passed |
| 完整台词不进入章节格 | 模型 `section` 被程序权威编号覆盖 | 长文本 section 测试 | passed |
| 一句一章被消除 | 章节边界只来自原文正式标题 | 无标题与两章测试 | passed |
| 历史工程打开即可正确显示 | GET 时规范化 | 服务端接口测试 | passed |
| 保存后编号持久化 | PUT 前执行章节专项规范 | 持久化文件断言 | passed |
| AI 新分析不再生成逐句章节 | 分析合并后统一编号 | Python 分析测试 | passed |
| 章节音频分组与 UI 一致 | 两者共用规范后 `section` | 代码路径检查 | passed |
| 全量回归和生产构建 | Node 151，Python 318，Vite 构建 | `test_results.md` | passed |
| Docker 运行与健康 | 镜像 `indextts25-product-studio:1.1.50-02d8a7f`，`running / healthy`，RestartCount 0 | `docker inspect` 与 `/api/health` | passed |
| 浏览器页面、Console 与截图 | 白夜行01和白夜行03第一页均为 20 个“第 1 章”，Console 0 error | `artifacts/chapter-numbering-segmentation/` | passed |
| 实际工程数据持久化 | 三个工程的 `segments` 与 `director_memory.segments` 均已写回“第 1 章” | 三个 `project.json` 物理复核 | passed |
| Git `master` 提交 | 实现提交 `4c802809b50f090601af1a83d1532503181627d9` 已进入 `master` | `git log` | passed |
| Git 推送与远端相等 | 本回执提交后执行并记录最终远端核对 | `git ls-remote` | pending |
