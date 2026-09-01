# 证据索引

| 结论 | 证据 | 置信度 | 限制 |
|---|---|---|---|
| C 为 NVMe SSD，D 为 SATA HDD | `Get-PhysicalDisk`、`Get-Disk`、`Get-Partition` | 高 | 当前机器时点证据 |
| Docker 普通命名卷位于 D 盘 | `settings-store.json` 的 `CustomWslDistroDir` 与 VHDX 实际路径 | 高 | Docker Desktop 设置变化后需重查 |
| SSD 挂载被提交回退 | `git log -p -- compose.yaml`，提交 `6989cdd` 与 `a44e59d` | 高 | Git 只能证明配置变化，不能证明主观原因 |
| SSD 模型与旧卷一致 | 文件数、总字节、五项核心 SHA256 | 高 | 未对 113 个文件执行全量逐文件哈希 |
| 当前容器从 SSD 模型卷读取 | `docker inspect` 与 `docker volume inspect indextts25-models-ssd` | 高 | 外部卷依赖本机 C 盘路径 |
| SSD 冷启动明显改善 | HDD 作业 6 分 21 秒，SSD 作业 163.3 秒 | 高 | 含 Python 导入和 GPU 初始化，不是纯磁盘基准 |
| 驻留复用正常 | 热作业 7.823 秒，`model_reused=true` | 高 | 单个分句样本 |
| 页面运行正常 | 浏览器 DOM、Console 0 warning / 0 error、截图 | 高 | 页面截图不展示物理盘路径 |

浏览器截图：`artifacts/ssd-model-migration-20260901/product-studio-delivery-ssd.png`。
