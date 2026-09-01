# 测试结果

| 测试 | 结果 | 状态 |
|---|---:|---|
| `tests/test_text_director.py` | 74 passed | 通过 |
| Product Studio 全量 Node 测试 | 152 passed | 通过 |
| Vite 生产构建 | 3106 modules transformed | 通过，存在既有大 chunk 警告 |
| Docker 镜像与容器 | 功能镜像 `1.1.55-a7fbdbf` 验收通过；最终回执提交后的现行镜像以发布后外部一致性检查为准 | 通过 |
| 浏览器 DOM、Console、截图 | 第 165 条参数与候选操作区可见，Console error 0 | 通过 |
| 第 165 条真实重新生成 | 三版相似度 0.800、0.797、0.730，门禁均为 0.720，当前片断未自动替换 | 通过 |

首次容器浏览器检查发现历史候选仍沿用旧 `quality_passed`，造成基础音频和音色证据缺失时显示综合通过。实现已改为缺少新证据时关闭门禁，并新增服务端回归测试。全部最终验收需要从起点重新执行。

返工后第一次 Vite 命令从仓库根目录运行，因入口目录错误报告 `Cannot resolve entry module index.html`。随后从 `product-studio` 目录执行相同生产构建，3106 个模块完成转换并通过。

使用者补充要求待复核候选仍可人工采用。接口与页面调整后，Python 74 项、Product Studio 152 项和 Vite 3106 模块生产构建重新通过。服务端测试验证人工采用写入 `manual_override`、采用时间和 `human_listening_accepted`。

现行容器浏览器验收进入第 9 页并定位第 165 条“哦，在意时间。”。页面显示态度“中性叙述”、情绪“平静”、句内节奏“低声”、情绪演绎“暗自思忖”、权重 `0.70`。历史待复核候选的两枚“人工采用此版”按钮均可用。

随后从真实页面启动第 165 条高级三版重新生成。任务经历 CUDA 导入、IndexTTS 2.5 加载和渲染后正常结束。三版新候选的 CAMPPlus 相似度分别为 `0.800`、`0.797`、`0.730`，全部超过 `0.720` 门禁，基础音频和系统门禁均显示通过。页面仍保留生成前的当前片断，三版新候选均等待人工采用。生成前后 Console error 均为 0。

截图证据：

- `artifacts/segment-voice-reference-quality-gate/final-browser-segment-165-parameters.png`
- `artifacts/segment-voice-reference-quality-gate/final-browser-segment-165-candidates.png`
- `artifacts/segment-voice-reference-quality-gate/final-browser-segment-165-new-candidates.png`
- `artifacts/segment-voice-reference-quality-gate/final-browser-segment-165-new-scores.png`
