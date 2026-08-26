# 完整音频实时 MP3 下载调查与实现

## 目标

在完整交付的 WAV 下载旁增加 MP3 下载，并在每次下载时从当前完整 WAV 实时编码。

## 调用链

React 交付页从 `latest-render` 取得 WAV、MP3、分轨包和导演清单链接。MP3 链接进入 Node `render-file/<renderId>/mp3` 路由。路由确认目标 `full-audio.wav` 存在后启动 FFmpeg，将 `libmp3lame` 编码结果从 stdout 直接流式返回浏览器。该流程不写入 MP3 文件，不进入 Python Worker，也不加载 TTS 模型。

## 实现结果

页面显示相邻的“下载 WAV”和“下载 MP3”，并显示 160 kbps 实时编码说明。成果物链接区增加可打开、可复制的 MP3 地址。响应使用 `audio/mpeg`、`Cache-Control: no-store` 和兼容中文交付标识的 RFC 5987 下载文件名。

源 WAV 为 22050 Hz 单声道，编码采用 MPEG-2 Layer III 的 160 kbps 标准码率。真实 823.066 秒音频下载得到 16,461,366 字节 MP3，完整解码无错误，工程交付目录内 MP3 文件计数保持为 0。

## 运行期返工

首次真实请求把中文交付标识直接放入 `Content-Disposition`，Node 触发 `ERR_INVALID_CHAR`。实现改为 ASCII 回退文件名和 UTF-8 `filename*`，测试也改用中文 render ID 覆盖该分支。随后从单元测试起点重新执行全部验收。
