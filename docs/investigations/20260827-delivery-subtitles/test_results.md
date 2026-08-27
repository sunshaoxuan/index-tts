# 测试结果

## 自动测试

`pnpm test`：77 passed，0 failed。新增覆盖真实 WAV 时长解析、接口字幕字段、累计时间轴、句间边界、中段与结尾定位。

`pnpm run build`：通过。Vite 转换 3098 个模块并生成生产资源。构建保留既有大包体积警告。

## 真实运行

固定端口：7864。

服务 PID：13592。

健康状态：`ok`。

产品版本：1.1.0。

字幕数量：133。

播放推进：1 / 133 到 2 / 133。

中段定位：408.4 秒，62 / 133，字幕容器滚动位置 2998。

末尾定位：816 秒，133 / 133，内容为“哀泣的声音从她身后传了出来。”。

Console：0 warning，0 error。

截图：`artifacts/delivery-subtitles/browser-start.png`、`browser-mid-seek.png`、`browser-end-seek.png`。
