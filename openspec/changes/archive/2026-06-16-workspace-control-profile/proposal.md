## Why

当前 MCP 每次拉起硬件控制时都可能重新询问串口、J-Link、芯片、烧录地址和固件路径等事实，既慢又容易猜错。项目需要一个工作区本地、可见、可复用的控制配置文件，并提供 MCP 与人类 UI 两个入口来生成和维护它。

## What Changes

- 新增工作区本地 `.linkterm/control-profile.json`，用于保存串口、J-Link、flash、RTT 控制事实。
- MCP 只读取该文件执行快速控制拉起；缺失文件时返回明确错误，不再隐式猜测。
- MCP 提供问答式初始化/补全工具，将人类自然语言回答解析并写入配置。
- Renderer UI 提供人类可用的控制配置面板，支持中英文、下拉候选、工作区目录选择和固件文件选择。
- J-Link 速度支持 `auto`，激活时从最高速开始失败回退。
- Flash 起始地址必须保存为十六进制字符串，例如 `0x08000000`。

## Capabilities

### New Capabilities
- `workspace-control-profile`: 工作区控制配置文件、MCP 快速拉起、问答补全、双语 UI 与路径/速度选择。

### Modified Capabilities
- None

## Impact

- Core workspace: 新增控制配置 schema、manager、自然语言解析器。
- MCP: 新增 control-profile surface 并接入 server/runtime。
- Main IPC/preload: 新增保存/读取控制配置和路径选择通道。
- Renderer: 新增控制配置面板并接入 i18n。
- Tests: 新增 core、MCP、renderer 单元测试覆盖。
