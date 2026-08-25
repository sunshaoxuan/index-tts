# 测试结果

## 单元与静态检查

1. `py_compile` 通过。
2. 释放协议、导入顺序、内存门禁与 CUDA 缓存释放聚焦测试 11 passed。
3. 包含既有 VoiceDesign 测试的组合运行 17 passed，1 个第三方弃用警告。
4. 完整非 GPU 回归 227 passed，22 deselected，30 subtests passed，3 个第三方弃用警告。
5. Node 服务测试 10 passed。
6. Vite 生产构建通过，3089 个模块转换完成。

## 真实运行

1. 任务 `801de0037c2c4188873e7fc86ca166e2` 完成。
2. 完整 WAV 为单声道、22050 Hz、17493237 帧、793.344 秒。
3. ZIP 共 144 个条目，`ZipFile.testzip()` 返回空值，CRC 全部通过。
4. 输出目录包含 142 个 WAV、1 个 CSV、1 个 JSON 和 1 个 ZIP。
5. 完整音频 SHA-256 为 `DD3547DD10A06DF04D650F662FDE3605C8402DFCD319331D91FED941A2BC6B6F`。
6. 交付包 SHA-256 为 `29B4DEA84A7007EDE6F8BADD762F73973B9FE99A97E056D1682E596ADBFC15E4`。
7. 导演清单 SHA-256 为 `2B7A962FE43064F6AE80AA94754F673C0315390BF6E08D1BB885D50ACDC60789`。

## 浏览器

1. 加载态显示 2% 与“正在加载 IndexTTS 2.5”。
2. 渲染态显示 3% 与“正在生成 4/102”。
3. 完成态显示交付成功，播放器总时长 13:13，实际播放推进到 0:02。
4. 三个阶段的 Console 均为 0 错误和 0 警告。
5. 加载态、渲染态和完成态截图验证通过。
