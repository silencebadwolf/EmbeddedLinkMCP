## Context

LinkTerm v2 已有会话、串口枚举、J-Link backend 抽象和 MCP runtime。此前没有一个明确的工作区本地控制配置生命周期：文件不可见、没有统一生成入口，也没有保证 MCP 实际读取并依赖该文件。

## Goals / Non-Goals

**Goals:**
- 提供工作区本地 `.linkterm/control-profile.json` 作为硬件控制事实来源。
- 提供 MCP/chat wizard 和 renderer UI 两个入口生成同一配置文件。
- 保证 MCP 激活控制时读取该文件；无文件则不工作并返回明确错误。
- UI 必须同步中英文，不引入英文硬编码回归。
- 常用值尽量使用下拉或候选，减少误填。
- `speedKHz: "auto"` 表示从最高 J-Link 速度开始尝试，并在失败时向下回退。
- 工作区目录和固件路径应可通过系统选择器选择。

**Non-Goals:**
- 本次不支持多 profile。
- 激活控制不执行烧录、擦除、复位、halt 或启动 GDB server。
- 不保存 J-Link 序列号、SSH 凭据或其它敏感字段。

## Decisions

- 使用独立文件 `.linkterm/control-profile.json`，避免和其它 workspace facts 混淆。
- 文件 schema 使用 `linkterm-control/1.0.0`，由 manager 写入，caller 不直接写 schemaVersion。
- `flash.baseAddress` 使用字符串并由 Zod 强制 `0x...` 格式，拒绝十进制地址。
- MCP 初始化/读取/检查/问答/激活工具共用同一个 `ControlProfileManager`。
- Renderer 通过 preload 暴露窄接口；不暴露 `ipcRenderer`。
- UI 字符串全部接入现有 `useT()` 和中英翻译表。
- `auto` 速度在 MCP 激活阶段按 `[50000, 25000, 10000, 8000, 4000, 1000]` kHz 回退尝试，只对 J-Link 操作失败进行回退。

## Risks / Trade-offs

- `auto` 回退需要依赖 backend 把“速度过高”映射为可恢复的 J-Link 操作失败；真实 backend 接入后可能需要更细的错误分类。
- UI 下拉候选不能覆盖所有芯片/波特率，因此芯片字段保留可手填。
- 系统文件选择器只能返回本机路径；跨环境路径仍需用户确认。
