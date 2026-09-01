# 最终验收清单

| 原始要求 | 成果物 | 证据 | 状态 |
|---|---|---|---|
| 分镜生成使用对应角色照片 | Images Edits 多图请求 | multipart 测试验证实际文件字节 | 合格 |
| 同一人物跨镜头保持容貌机制 | 原始角色图固定身份锚点、稳定角色 ID 映射、身份提示约束 | 服务端实现与 prompt 断言 | 合格 |
| 角色照片真实参与生成链路 | `image[]` 请求字段 | 单张与全量测试 | 合格 |
| 支持当前工程和关联工程角色图 | 安全 URL 解析与跨工程读取 | linked-source fixture | 合格 |
| 旁白不作为画面人物 | narrator 排除 | 请求图片数量与 prompt 断言 | 合格 |
| 缺图时给出明确处理 | 服务端预检和 UI 门禁 | 远端调用次数 0、页面警告截图 | 合格 |
| 单张与全量共用机制 | 统一生成函数和全量预检 | 路由与接口测试 | 合格 |
| 保存可审计参考记录 | 模式、ID、名称、URL、SHA256 | API 类型和响应测试 | 合格 |
| 页面显示人物一致性状态 | 已使用、已就绪、缺资料三种状态 | 桌面和移动截图 | 合格 |
| README、CHANGELOG、需求和架构同步 | 四份正式文档 | Git 差异 | 合格 |
| 单元、回归、构建和运行时页面 | 164 Node、19 Python、生产构建、健康容器、浏览器、Console | `test_results.md` | 合格 |
| 真实兼容服务接受 `/images/edits` | 外部付费调用 | 未执行 | `evidence_missing` |
| Git master 交付 | 实现提交 `1f883dcd39d38babf34c2b801f969c64ec8fe65b` 已推送 | 本地 HEAD、`refs/remotes/fork/master`、`git ls-remote fork refs/heads/master` 三者一致 | 合格 |

功能、文档、测试、页面与 Git 交付条目均已合格。真实外部 Images Edits 为费用边界内的明确验证缺口，状态保持 `evidence_missing`，不把 mock 合约验证表述为真实供应商运行验证。
