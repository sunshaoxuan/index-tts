# 命令记录

1. `pnpm test`
2. `pnpm run build`
3. `scripts/start_indextts25_windows.ps1 -SkipBuild`
4. 读取 `/api/health`、`/api/active-job`、`/api/projects` 和 `latest-render`
5. 使用 `curl.exe` 下载真实 MP3，并保存响应头
6. 使用 `ffprobe.exe` 检查编码、采样率、声道、时长和码率
7. 使用 `ffmpeg.exe -v error` 完整解码下载文件
8. 浏览器检查真实交付页 DOM、Console 与截图
9. 递归检查当前工程交付目录中的 MP3 文件数量
