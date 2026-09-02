# 测试结果

| 验证 | 结果 |
|---|---|
| 接口级拆分序号冲突回归 | 2 项通过，覆盖旧插入场景和本次 `latest-render` 过程片断读取场景 |
| Product Studio 全量测试 | 166 项通过，0 失败 |
| TypeScript 与 Vite 生产构建 | 通过，3108 个模块完成转换；保留既有大包体积警告 |
| 静态差异检查 | `git diff --check` 通过 |
| 首轮部署镜像 | `indextts25-product-studio:1.1.62-8cbdb7d`，revision `8cbdb7dec66c11980a4c43e6fd12785888564d93` |
| 容器状态 | running、healthy、RestartCount 0，GPU 与五项挂载保持不变 |
| 部署接口 | 同历史序号 15 的两个不同文本片断返回为当前序号 15、16，两条 WAV 均为 HTTP 200 |
| 浏览器 DOM | 最近交付 2 个片断、匹配 2 个、待生成 0 条，第 15 与 16 句均显示播放器 |
| 浏览器媒体 | 两条 `readyState=4`，时长 21.466848 秒与 19.156463 秒，后一句实际播放成功，无媒体错误 |
| 浏览器 Console | warning 0、error 0 |
| 截图 | `artifacts/segment-split-audio-preservation/runtime-acceptance.png` 视觉检查通过 |
| 临时工程清理 | 产品删除接口返回 `deleted=true`，剩余 4 个原有工程，临时目录不存在 |
