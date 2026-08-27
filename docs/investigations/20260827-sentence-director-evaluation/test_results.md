# 测试结果

## 调查开始时的相关测试

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_director_memory.py tests\test_novel_project.py -q
```

结果：`64 passed in 0.34s`

覆盖范围：Schema 校验、原文完整性、引号拆分、确定性回退、导演记忆重应用、分句表往返。

未覆盖范围：真实小说分句边界质量、角色归属准确率、别名合并、场景边界、态度与节奏一致性、强度和停顿人工金标准、模型质量成本延迟比较。

## 报告完成后的最终重跑

结果：`64 passed in 0.25s`

退出码：`0`

结论：本轮调查文档生成后，相关测试集继续全部通过。

## 实施后的完整验证

### Python

命令：

```powershell
.\.venv\Scripts\python.exe -m pytest -m "not gpu" -q
```

结果：`275 passed, 22 deselected, 30 subtests passed in 12.13s`。退出码为 0。三条现有依赖弃用警告没有测试失败。

### Node、React 与 TypeScript

命令：

```powershell
pnpm --dir product-studio test
```

结果：`69 passed, 0 failed`。覆盖全局设置存储和模型发现、分析任务密钥隔离、角色删除引用清理、删除控件事件隔离和既有产品行为。

### 生产构建

命令：

```powershell
pnpm --dir product-studio run build
```

结果：TypeScript 编译和 Vite 生产构建成功。Vite 报告单个主包超过 1100 kB 的现有体积警告，构建退出码为 0。

### 运行页面

产品服务运行于 `http://127.0.0.1:7864/`。浏览器验证结果：

1. 工程控制区显示全局 AI 设置，全文 Provider、模型、Endpoint、块长度和兼容文本接口均可见。
2. 角色资产页显示 8 个删除入口，旁白禁用，普通角色启用。笹垣润三确认框准确显示 17 条引用分句。
3. 取消删除后角色编辑弹窗数量为 0，事件冒泡修复生效。
4. 场景分析页正常显示旧工程空状态和低置信度复核说明。
5. Console 为 0 warning 和 0 error。

### 模型发现

全局导演测试接口返回 `ok: true`，Provider 为 Ollama，可用模型为 `qwen3:8b`、`qwen3:14b` 和 `qwen3-embedding:8b`。
