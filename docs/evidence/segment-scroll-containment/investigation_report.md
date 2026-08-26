# 分句表滚动链调查与修复

## 用户初衷

鼠标、触控板或触摸操作位于分句导演表格时，滚动只作用于表格，页面位置保持稳定。

## 根因

分句表实际滚动容器为 `.ant-table-body`。修复前该容器纵向和横向的计算样式均为 `overscroll-behavior: auto`，现有滚动链隔离只覆盖 Select 弹层和角色编辑弹窗。

## 修复

分句表增加专用 `segment-table` 类。CSS 对表格容器和滚动体启用双轴 `overscroll-behavior: contain`。页面级 wheel 处理只匹配该表格，在四个边界阻止默认滚动并停止传播；表格内部仍保留原生纵向与横向滚动。

## 运行态结果

修复后计算样式的 `overscroll-behavior-x/y` 均为 `contain`。最终服务上的真实滚轮覆盖表格中段、顶部、底部、左侧和右侧，页面 `scrollY` 全程保持 1445。
