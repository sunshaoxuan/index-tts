# 命令记录

1. `pnpm test`
2. `pnpm run build`
3. 使用 `buildApp().inject()` 读取真实工程最新交付并与 `wavDurationSeconds(full-audio.wav)` 比较。
4. 使用 `scripts/start_indextts25_windows.ps1 -SkipBuild` 接管固定端口 7864。
5. 浏览器打开 `http://127.0.0.1:7864/`，进入完整音频与交付页，执行播放、408.4 秒定位、812 秒定位、816 秒定位、Console 和截图检查。
