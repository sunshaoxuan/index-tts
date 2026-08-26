# 测试结果

## 自动测试

| 项目 | 结果 |
| --- | --- |
| Python 全量非 GPU | 262 passed，22 deselected，30 subtests passed |
| Node | 56 passed，0 failed |
| TypeScript | `tsc -b` 通过 |
| Vite | 3094 modules transformed，生产构建通过 |
| 年龄样本 | 四项自动方向检查全部通过 |

Vite 保留一个既存的大 chunk 提示。该提示不影响构建产物和本次功能运行。

## 浏览器验收

| 检查项 | 结果 |
| --- | --- |
| Product Edition | 1.1.0 |
| 十二项语义滑块 | 全部可见且显示角色独立值 |
| 原生参数 | 主采样和 Subtalker 参数全部可见 |
| 草稿隔离 | 修改候选数量时工程保存按钮保持禁用 |
| 应用状态 | 点击应用角色设置后保存按钮点亮，并显示有未保存修改 |
| 用户项目保护 | 未点击保存，磁盘 `project.json` 未改写 |
| 窄屏 | 390×844，页面宽度与滚动宽度均为 390 |
| Console | 空列表，零 error，零 warning |

## 运行环境

| 项目 | 结果 |
| --- | --- |
| 地址 | `http://127.0.0.1:7864/` |
| Node | v24.19.0，PID 34168 |
| VoiceDesign | loaded，ready，PID 37240 |
| 模型目录 | `checkpoints/Qwen3-TTS-12Hz-1.7B-VoiceDesign` |
