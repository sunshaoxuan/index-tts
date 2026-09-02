# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| 重复根因为镜头切分复用场景小记 | 旧白夜行01 第一场景 8 镜头数据、`storyboard_regeneration.py` 父版本与当前差异 | 高 | 生产工程旧数据未写回 |
| 每个镜头独立消费自己的完整原文 | `text_director.py::author_storyboard_shots`、`tests/test_text_director.py` | 高 | 外部兼容文本服务未单独实跑 |
| 取景证据不能跨镜头且重复描述被拒绝 | 101 项 Python 聚焦回归中的证据归属、重复与整批重写测试 | 高 | 描述相似度目前只拒绝规范化后完全相同 |
| 白夜行第一场景 8 条小记全部唯一 | 本机 `qwen3:14b` 内存副本实跑，8/8 ID、8/8 证据、8/8 唯一描述 | 高 | 177.218 秒，未写回生产工程 |
| 人物姓名和代词连续性会补齐稳定角色 ID | `text_director.py` 确定性解析、角色连续性单元测试 | 高 | 多人物代词歧义时保持克制，不自动猜测 |
| 生图提示包含当前镜头原文和独立小记 | `product-studio/server/index.mjs`、服务端提示测试 | 高 | 真实付费图像供应商未调用 |
| 页面逐镜头显示原文和 AI 取景证据 | `storyboard-shot-source-desktop-final.png`、`storyboard-shot-source-detail-mobile-final.png` | 高 | 浏览器使用 3 镜头工程副本 |
| 角色原图参与镜头 2 和 3 的生成链路 | 生成后 DOM 文案、`storyboard-shot-identity-mobile-final.png` | 高 | 图像响应来自本机 mock |
| 根因为一次批量请求和单一布尔状态 | `product-studio/src/App.tsx`、`product-studio/server/index.mjs` 的当前差异 | 高 | 历史行为以 Git 父版本为准 |
| 全量生成前完成一次完整预检 | `preflightOnly` 路由、服务端测试、批处理状态机测试 | 高 | 外部图像服务未调用 |
| 关键帧按稳定顺序逐张生成 | `storyboardKeyframeBatch.ts` 和 8 项聚焦测试 | 高 | 默认串行执行 |
| 页面实时显示数量、百分比、当前镜头和时间 | `storyboard-progress-desktop-one-of-three.png`、`storyboard-progress-desktop-two-of-three.png` | 高 | 使用 2.2 秒延迟 mock |
| 生成期间冲突操作锁定 | 浏览器 disabled 状态记录、`storyboard-progress-desktop-one-of-three.png` | 高 | 只验证分镜相关冲突面 |
| 失败保留已完成图片并解除锁定 | `storyboard-progress-desktop-failure.png`、DOM 第一张图片计数 1 | 高 | 模拟第 2 张返回 HTTP 503 |
| 单张生成显示等待并可取消 | 浏览器运行记录、`longOperationCancellationUI.test.ts` | 高 | 取消发生在 mock 响应前 |
| 移动端标题与标签无重叠且无横向溢出 | `storyboard-scene-header-mobile-final.png`，`overlap=false`，375/375/375 | 高 | 390 x 844 视口 |
| Console 无 error 与 warning | in-app Browser `tab.dev.logs` 返回空数组 | 高 | 隔离页面会话 |
| 全量自动化回归通过 | `test_results.md`，187 Node、101 Python | 高 | Vite 存在既有 chunk 体积提示 |
| 真实图像供应商接受并生成 | 外部付费调用 | 低 | `evidence_missing` |

## 截图 SHA256

| 文件 | SHA256 |
|---|---|
| `storyboard-progress-desktop-running.png` | `B56258960B4CAB7AF4000357798779FAFD885535D78B77F9E27953C0AD326E04` |
| `storyboard-progress-desktop-one-of-three.png` | `88F0BF468BE73908062ECBAB101D331BC886748EF17728B2A0789DDC7E8ECE6A` |
| `storyboard-progress-desktop-two-of-three.png` | `50A568A115A56EB80DB4794DA809A0FB8F6EF7D3671857EA66BFC21B8EE2CDB9` |
| `storyboard-progress-desktop-complete.png` | `BBAE2BE2FD466179AD507B05C5C1906D020FB74E50962E3F062C56E2E9DB7546` |
| `storyboard-progress-desktop-failure.png` | `92D61DCE8B8A6CA905E034ED4AB91026E83A09DC6EFD3F9A83CC04976FA21598` |
| `storyboard-progress-mobile-one-of-three.png` | `C04711A700AAFBC6AF36E6563543B0C2CCF21E5466562B2CE9120E085A7A8B51` |
| `storyboard-progress-desktop-one-of-three-final.png` | `3C7502AEE98A653053259233CE7D7066C3F34C90E949944C062F0053693A4BEF` |
| `storyboard-scene-header-mobile-final.png` | `7B873ED6EF0AF6CD716D6821F864530D6E1126C17327F4944B85EB09B7050F20` |
| `storyboard-shot-source-desktop-final.png` | `A14D19E79DF4293FC50EA2AC57B7CA7AEC523AD96F10B8016956262DD7FE6BC2` |
| `storyboard-shot-source-detail-mobile-final.png` | `969C1F5394175C61FCC643160EB590930EB7C3CBC5F90E5244C1E2E78827F1E9` |
| `storyboard-shot-identity-mobile-final.png` | `1DFBBD966C0430A0392728611A084A3E5A636935BC78FB927BB4BCF9C20B36A1` |
| `storyboard-progress-desktop-failure-final.png` | `BBBE642BF45A29F7F2495BC59544E400A6FADC44EF50AF7410C43759CC02FAB8` |
