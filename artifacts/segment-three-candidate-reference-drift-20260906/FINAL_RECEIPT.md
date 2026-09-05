# 最终验收回执

## 修复结果

高级三版现在固定使用角色当前同一个参考 WAV，关闭随机情绪原型，使用 0.82 CAMPPlus 音色门槛，并把音质、音色和适用重音校验合并为候选硬门禁。展示层优先返回后写入的新待选候选集合。

## 真实验收结果

第 24 句真实 GPU 生成得到 0.862589、0.862504 和 0.845174。三版均通过 0.82 音色门槛与完整自动门禁，均保持待人工试听采用。浏览器显示值和 API 一致，三个候选均能播放，Console error 为 0，截图已保存。

## 运行与交付

当前容器为 `indextts25-product-studio:1.1.87-7c0ac04`，状态 healthy，RestartCount 为 0，OCI revision 为 `7c0ac0479010cf8a0c82fd3ddd630328c8e35997`。功能代码和验收证据均已提交到 `master`，`HEAD`、`fork/master` 和远端 `refs/heads/master` 三方等值核验通过。
