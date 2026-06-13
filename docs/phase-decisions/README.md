# Phase 决策记录

本目录保存 `/next-phase` 自动推进流程中，每个 Phase 执行期间的决策记录。

每个文件命名为 `PhaseN.md`，内容由 `/next-phase` 命令在执行该 Phase 时自动写入，包含：

- 子代理被询问的问题、候选项、选中项、选择理由
- 全自动模式下自动应答的"确认/选择"操作
- 验收命令（lint/test/build/validate:licenses）的输出摘要
- 阻塞点（如有）

阅读这些文件可以回溯"为什么 Phase N 选了 A 没选 B"。
