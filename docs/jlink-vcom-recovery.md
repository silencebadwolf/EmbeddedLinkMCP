# J-Link VCOM 串口恢复

当更换 J-Link 后，Windows COM 号和 USB PID 可能变化，已保存工作区因此可能找不到原串口。LinkTerm 会保存不可逆的 USB 身份摘要；能确认是同一设备时原位更新记录，无法确认时要求人工选择，不按 COM 号猜设备。

## 在 LinkTerm 中恢复

1. 在首页已保存工作区中选择“修复”。
2. 工作区必须同时启用串口、J-Link，并将调试接口配置为 `SWD`。
3. 点击“恢复 J-Link 串口”。这是显式操作；readiness 和应用启动不会自动启用 VCOM。
4. LinkTerm 先重新扫描串口并尝试可信替换。只有串口仍缺失、当前只有一个 J-Link，且 Commander 明确报告 VCOM 已关闭时，才执行 `vcom enable`。
5. 如果出现唯一的新 `JLink CDC UART Port`，LinkTerm 会先打开它，再原位更新工作区记录；现有会话不会被关闭或迁移。
6. 如果提示需要电源循环，请重新插拔/重启 J-Link，再点击一次恢复。若有多个探针或多个新 CDC 端口，需人工选择，工具不会自动猜测。

## SEGGER 官方约束

- 官方说明：[Using J-Link VCOM functionality](https://kb.segger.com/Using_J-Link_VCOM_functionality)
- Commander 启用命令：`vcom enable`
- VCOM 仅可与 `SWD` 配合使用。
- 启用后需要 USB 重新枚举；某些型号需要断电重连。
- J-Link VCOM TX 为 5 脚，RX 为 17 脚；同时需要正确连接 VTref 和 GND。
- Commander 第一次连接较旧探针时可能自动升级探针固件。LinkTerm 会在输出中检测并提示该事实，但不会把“固件已升级”等同于串口已经可用。

## 安全与失败语义

- `vcom` 不在通用 Commander 脚本白名单中，使用独立、固定命令路径。
- VCOM 维护与 flash、reset、GDB、RTT 共用物理探针互斥；活动 GDB/RTT 会话存在时拒绝执行。
- 多探针时不自动选择；原始 J-Link 序列号只在 Main 进程中用于选择，不写入 Renderer/MCP 结果或保存配置。
- Commander 输出没有明确确认 `enabled/disabled` 时按失败关闭，不修改配置。
- 新端口必须成功打开后才会写回保存记录；打开失败时保留原配置。
