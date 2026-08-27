# 完整音频播放器边界修正

## 用户观察

完整音频播放器的总时长显示超出播放器和字幕外框。

## 根因证据

980px 视口下，外层 `.studio-audio-block` 的内容区宽度为 682px，内层 `.studio-audio` 仍使用固定 720px 宽度。内层右边界为 788px，外层边框右边界为 769px，总时长越界 19px。外层 `scrollWidth` 为 738px，`clientWidth` 为 718px。

## 修正契约

1. 内层播放器宽度使用父容器内容区的 100%。
2. 播放按钮和两侧时间使用内容宽度列。
3. 进度条使用 `minmax(0, 1fr)` 并允许自身收缩。
4. 时间文本禁止换行。
5. 桌面、窄屏和移动端均检查播放器、时间、字幕容器、页面横向溢出和 Console。

## 回滚

回退本次播放器 CSS 和 `deliveryPlayerLayout.test.ts`，重新构建并重启 7864 服务。

## 最终验收

| 视口 | 外层 clientWidth / scrollWidth | 播放器宽度 | 播放器右边界 | 字幕右边界 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 1440×1000 | 718 / 718 | 682px | 750px | 750px | 通过 |
| 980×900 | 718 / 718 | 682px | 750px | 750px | 通过 |
| 390×844 | 292 / 292 | 256px | 306px | 306px | 通过 |

三个视口的页面 `scrollWidth` 均等于 `clientWidth`，浏览器 Console 的 warning 和 error 为空。完整测试 90 项通过，生产构建生成 `index-B7-sRdXW.css` 和 `index-DAFU2AkT.js`。
