# 命令记录

```powershell
Get-PhysicalDisk
Get-Disk
Get-Partition
Get-Volume -DriveLetter C,D
docker inspect indextts25-product-studio
docker volume inspect indextts25-indextts-model indextts25-qwen-voice-design-model
docker volume inspect indextts25-models-ssd
git log -p -- compose.yaml
docker compose config --quiet
git diff --check
```

SSD 外部卷创建命令：

```powershell
docker volume create --driver local --opt type=none --opt o=bind --opt device=/run/desktop/mnt/host/c/workspace/IndexTTS-2.5/models/checkpoints indextts25-models-ssd
```

运行容器重建时使用当前已验收镜像 `indextts25-product-studio:1.1.59-storyboard-working`，避免被仓库 Compose 中较旧的构建标签降级。
