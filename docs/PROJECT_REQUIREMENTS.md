# LinkTerm Electron v2 项目需求文档

## 1. 项目背景

LinkTerm v2 是 LinkTerm 的 Electron/TypeScript 重写版本，目标是替代旧有 Qt/C++ 终端实现，形成一个单一运行时的桌面终端与 MCP 自动化平台。项目需要同时服务普通终端用户、嵌入式固件开发者，以及通过 MCP 控制终端和调试链路的 AI Host。

## 2. 项目目标

- 使用 Electron/TypeScript 构建独立的 LinkTerm v2 运行时，不依赖 Qt/QML/C++ 承载 v2 功能。
- 基于成熟终端渲染与 VT/xterm 行为栈，避免维护自研终端模拟器。
- 在一个产品中统一支持串口、SSH、本地 Shell、嵌入式终端、MCP 控制、J-Link/debug/RTT/GDB 相关工作流。
- 为 AI 自动化提供安全、结构化、可审计的 MCP 工具边界。
- 支持 AI 与人对同一终端会话共同操作：AI 能读写终端，人能实时看到 AI 的操作和信息，AI 也能实时看到人的操作和信息。
- 支持 MCP 自动识别当前工作区，并把芯片型号、烧录地址、固件路径、J-Link 参数等项目级配置写入工作区，后续可直接复用。
- 保留第三方开源依赖的许可证归因与校验能力，确保项目可维护、可分发。

## 3. 用户角色

| 用户角色 | 核心诉求 |
| --- | --- |
| 桌面终端用户 | 使用稳定的桌面终端打开本地 Shell、SSH 和串口会话，并能看到 AI 在同一会话中的操作。 |
| 嵌入式固件开发者 | 使用串口、嵌入式终端、RTT、J-Link/debug 工作流进行开发和诊断。 |
| AI Host / MCP 客户端 | 通过 MCP 工具列出会话、打开连接、写入输入、读取输出、等待命令完成、截图取证，并能看到人对同一终端会话的输入和输出。 |
| 项目维护者 | 通过测试、构建、许可证校验和规格文档维持架构边界与合规性。 |

## 4. 功能范围

### 4.1 桌面应用运行时

- LinkTerm v2 必须是单一 Electron/TypeScript 应用。
- v2 的验收不得依赖旧 Qt 可执行文件或 Qt 运行库。
- 旧 Qt 实现可以在迁移阶段保留在仓库中，但不得作为 v2 功能依赖。
- 应用应提供最小桌面 UI，用于选择连接类型、填写连接参数、打开会话、展示终端输出。

### 4.2 终端会话

- 系统必须通过统一会话抽象支持以下会话类型：
  - 串口（Serial）
  - SSH
  - 本地 Shell（Local Shell）
- 串口会话必须支持两种工作模式：
  - 普通模式：面向串口助手场景，提供原始收发与手动发送能力，不启用终端命令完成等待逻辑。
  - 终端模式：面向交互式嵌入式终端场景，使用终端渲染、统一交互规则和 `sendAndWait` 能力。
- 串口工作模式必须在创建会话时明确指定，并在 UI 与 MCP 结构化状态中可见。
- 每个会话必须提供流式 API：
  - `write`
  - `read`
  - `clear`
  - `waitFor`
  - `resize`
  - `status`
- 会话输出必须写入可按 sequence cursor 读取的 transcript buffer。
- 多个 MCP 客户端并发访问同一会话时，系统必须保持会话状态与输出游标可预测。

### 4.3 嵌入式终端默认交互规则

嵌入式设备的终端模式采用一套固定通用规则，不按设备类型拆分配置。该规则用于发送命令、判断命令是否执行完，以及处理超时。

- 系统必须内置一套统一的嵌入式终端交互规则，适用于所有嵌入式设备终端模式。
- 统一规则至少应包含：
  - 固定行尾策略。
  - 固定命令完成判断方式。
  - 固定输入回显处理方式。
  - 固定默认等待超时。
- `sendAndWait` 表示「发送命令并等待命令执行完成」，必须能处理结束标记被拆成多个输出片段到达的场景。

### 4.4 MCP 终端控制

- MCP 终端工具必须只通过 LinkTerm 自有 session manager 操作会话。
- MCP 终端工具不得直接访问 COM 口、SSH 二进制、本地 shell 进程、J-Link/GDB 二进制或 VS Code task。
- MCP 终端工具必须提供结构化结果，至少包含：
  - `success`
  - `sessionId`
  - `state`
  - evidence kind
  - sequence cursor
  - 可执行错误信息
- MCP 终端工具必须支持串口设备发现与串口控制面状态查询，不要求用户先操作 UI。

### 4.5 AI 与人共同操作同步

AI 和人必须共享同一个 LinkTerm 会话状态，这是项目的核心需求。终端不应分成「AI 看见的一份」和「人看见的一份」。

- 人在 UI 里输入的内容必须进入同一个会话流，AI 能通过 MCP 读取到人的输入及其后续输出。
- AI 通过 MCP 写入的内容必须显示在同一个 UI 终端里，人能实时看到 AI 输入了什么、设备返回了什么。
- AI 和人的输入、输出、清屏、关闭会话、resize 等操作必须通过同一个 session manager 和 transcript buffer 同步。
- 每条终端事件应能区分来源，例如 `human`、`ai`、`device`、`system`，便于 UI 展示和 MCP 取证。
- MCP 读取输出时必须使用 sequence cursor，确保 AI 不漏看人触发的输出，也不会重复误判旧输出。
- UI 必须持续订阅会话 transcript 更新，确保人能看到 AI 操作后的实时变化。
- 当 AI 和人几乎同时写入同一会话时，系统必须按统一队列顺序处理并保留可审计记录，避免两边状态分叉。
- 清屏不得丢失 AI 可读取的审计证据；如 UI 需要清屏，MCP 仍应能获得清屏事件和新的 cursor 边界。

### 4.6 J-Link 调试、下载与探针工作流

- J-Link 提供的调试、下载、烧录和探针能力必须通过独立 MCP surface 封装给 AI 使用，不能混入普通终端 transcript。
- AI 必须通过 LinkTerm MCP 调用 J-Link 能力，用于连接目标板、调试、下载固件、擦除、校验、RTT 查看和故障诊断等工作流。
- Debug/probe 输出必须与终端会话输出隔离。
- J-Link MCP 能力应覆盖 J-Link 常用功能，包括：
  - probe 与目标芯片配置。
  - 连接、断开、识别设备和读取 probe 状态。
  - CPU 复位、暂停、运行、单步执行。
  - 断点、寄存器与内存读写。
  - 固件下载、Flash 擦除、Flash 写入与校验。
  - RTT 连接、日志读取、缓冲区清理与搜索。
  - GDB server/GDB 调试桥接。
  - 快照采集、崩溃诊断和错误分类。
- 该模块可以参考开源 J-Link MCP / `jlinkmcp` 仓库（https://github.com/daikw/JLinkMCP）的 MCP 工具划分、参数设计和返回结构。
- 参考开源仓库时必须先确认版本、许可证和可引用范围；未完成许可证审查前不得复制源码。
- 当没有注入 LinkTerm MCP debug backend 时，系统必须安全拒绝 debug、下载、烧录等 J-Link 操作。
- Electron 后端不得回退到直接执行外部 J-Link/GDB/flash CLI。

### 4.7 工作区识别与项目配置持久化

MCP 必须能识别当前工作区，并在首次接入一个嵌入式工程时，把后续调试、下载、烧录和终端连接所需的项目级配置保存到该工作区。这样 AI 下次进入同一工程时，可以直接读取配置并执行常用操作，不需要每次重新询问。

- MCP 必须能识别当前工作区根目录，并把配置与具体工作区绑定。
- 首次工程初始化时，系统必须收集或生成项目级配置，包括但不限于：
  - 芯片型号 / J-Link device 名称。
  - 调试接口类型（如 SWD/JTAG）和连接速度。
  - 固件文件路径。
  - Flash 烧录地址、校验方式和复位策略。
  - RTT 配置、终端串口参数和默认连接模式。
  - 常用 build、download、debug 命令入口或 MCP 操作入口。
- 这些配置必须写入工作区内的 LinkTerm 项目配置文件，成为该工程的可复用事实来源。
- 后续 MCP 工具调用必须优先读取工作区配置；缺少关键字段时再向用户请求补充。
- 配置文件不得保存密码、私钥、token 等敏感信息。
- 当工作区配置与当前硬件证据冲突时，MCP 必须返回结构化提示，并要求用户确认后再更新配置。

### 4.8 Agent 对接与稳定性

LinkTerm 对外统一通过 MCP 对接 AI Agent。默认优先验证 VS Code 中的 GitHub Copilot，因为它能读取当前工作区、触发 MCP 工具并配合开发者完成工程操作；同时协议必须保持标准 MCP 兼容，后续可接入其他支持 MCP 的 Agent。

- LinkTerm 不应绑定单一 Agent 厂商；核心能力必须通过标准 MCP tool/resource/schema 暴露。
- 首要对接对象是 VS Code GitHub Copilot / MCP Host，用于工作区识别、终端读写、J-Link 调试下载、UI 取证和项目配置初始化。
- 其他 MCP Agent 可以作为次级接入对象，但不得绕过 LinkTerm MCP 直接操作串口、J-Link、GDB 或工作区配置。
- MCP 服务启动时必须暴露能力清单、协议版本、工具 schema 版本和当前工作区身份。
- Agent 与 LinkTerm Electron App 之间的连接必须使用本机受控通道，并能处理 App 未启动、端口变化、连接断开和重连。
- 所有会改变设备或工作区状态的操作必须返回结构化 evidence、correlationId、操作来源和可复盘结果。
- 下载、擦除、复位、写配置等高影响操作必须具备明确参数来源：来自工作区配置、用户确认或本次 MCP 请求。
- 当 MCP server、Electron App、工作区配置或硬件 backend 版本不匹配时，系统必须拒绝危险操作并返回可执行修复提示。

### 4.9 UI 与可视化验证

- UI 必须在启动时自动扫描串口设备。
- UI 必须允许用户手动刷新串口列表。
- 当串口自动发现为空时，UI 必须允许手动输入串口。
- UI 必须将串口、SSH、本地 Shell 展示为明确不同的连接类型。
- UI 在串口连接类型下必须提供普通模式与终端模式选择，并按模式显示对应字段与说明。
- 不同连接类型必须展示对应的参数字段，避免无关字段干扰用户。
- 系统必须提供 LinkTerm 自有 MCP UI 配置工具，用于对运行中的 Electron BrowserWindow 应用受限 UI 状态。
- 系统必须提供 MCP 截图工具，用于捕获当前 Electron BrowserWindow 并保存 PNG 证据文件。
- UI 配置和截图结果必须使用 UI 专属 evidence kind，不得写入终端 transcript 或 debug probe 输出。

### 4.10 许可证与第三方依赖

- 所有运行时第三方依赖必须记录在 `third-party-manifest.json`。
- 必需的许可证文件必须保存在 `licenses/` 目录下。
- 构建或验证流程必须包含许可证清单校验。
- 当缺少第三方归因或许可证文件时，校验必须失败。

### 4.11 开源参考与借鉴范围

项目可以参考成熟开源项目的架构、接口边界和交互设计，但不得在未完成许可证审查、来源记录和归因文件补齐前复制或改写其源码。

| 开源参考 | 参考目的 | 引入约束 |
| --- | --- | --- |
| Electron | 桌面应用运行时、主进程与渲染进程架构。 | 作为运行时依赖记录许可证。 |
| `@xterm/xterm` | 终端渲染、VT/xterm 行为、浏览器端 terminal UI。 | 作为运行时依赖记录许可证。 |
| `tabby-terminal` | 成熟桌面终端产品形态、会话适配思路、终端体验参考。 | 仅通过受控依赖或适配层使用，禁止无归因复制源码。 |
| `@modelcontextprotocol/sdk` | MCP server/client 协议接入、工具注册与结构化结果。 | 作为运行时依赖记录许可证。 |
| `serialport` | Node.js 串口枚举、打开、读写能力。 | 作为运行时依赖记录许可证。 |
| `ssh2` | SSH 连接与流式通道能力。 | 作为运行时依赖记录许可证。 |
| `zod` | MCP 工具参数 schema 与边界校验。 | 作为运行时依赖记录许可证。 |
| J-Link MCP / `jlinkmcp` 仓库（https://github.com/daikw/JLinkMCP） | J-Link 调试、下载、烧录、RTT、GDB、probe 相关 MCP 工具划分、参数设计和返回结构参考。 | 仅作为 J-Link MCP 对接设计参考；版本、许可证和引用范围需在采用前补入依赖清单或设计文档；当前 GitHub 元数据未声明 license，未审查前不得复制源码。 |

## 5. 非功能需求

### 5.1 安全边界

- AI Host 只能通过 LinkTerm MCP 工具操作终端、UI 和 debug surface。
- 后端不得因为 MCP 请求而绕过 LinkTerm 自有抽象层直接调用系统工具。
- Debug 操作必须在没有有效 backend 时安全拒绝，并返回结构化失败证据。
- 工作区配置写入必须限制在当前工作区内，不得写入全局位置或其他项目目录。
- UI 控制端点应由 Electron 主进程拥有，并限制可配置字段范围。
- Agent 对接不得暴露未鉴权的远程控制入口；默认仅允许本机 MCP Host 访问。

### 5.2 可测试性

- 项目必须提供自动化测试覆盖：
  - Transcript buffer
  - 嵌入式终端统一交互规则
  - Session manager
  - AI 与人共同操作同一会话的同步行为
  - 工作区识别与项目配置读写
  - MCP Agent 对接握手、断线重连和版本不匹配处理
  - 终端 MCP 工具
  - Debug MCP 工具
  - UI control endpoint
  - UI/IPC 行为
  - 许可证清单校验
- 第一阶段测试不得依赖 Qt、串口硬件、SSH 服务器或 J-Link 设备。

### 5.3 可维护性

- 终端、debug、UI evidence 必须分层清晰。
- Session runtime、transport adapter、MCP handler、Electron UI 应保持可替换边界。
- Tabby、J-Link MCP / `jlinkmcp` 或其他成熟开源项目的引入必须受许可证、来源记录与适配层约束。

### 5.4 可观测性

- MCP 工具返回值必须包含足够的结构化证据，便于 AI Host 判断成功、失败与下一步动作。
- 终端 transcript 必须能体现人、AI、设备和系统事件的顺序，便于复盘共同操作过程。
- 截图证据必须落盘为 PNG 文件，并返回路径与 UI 状态元数据。
- Debug fatal 输出需要被分类，避免只依赖进程退出码判断成功。

## 6. 边界场景

- 串口已连接且可写，但长时间没有接收任何字节。
- 串口自动发现为空，但用户知道可用 COM 口。
- 串口设备在应用启动后插入，需要手动刷新后出现。
- 串口普通模式下收到非文本或半包数据时，系统仍应保留原始收发证据。
- 串口终端模式下等待命令完成超时时，系统应返回结构化超时信息而不是切换为普通模式。
- SSH 或串口字段存在未完成输入，但用户切换到其他连接类型。
- 嵌入式终端命令先 echo 输入，再打印执行结果。
- 命令完成标记跨多个输出 chunk 出现。
- 人在 UI 输入命令后，AI 必须能通过 MCP 看到该输入及设备响应。
- AI 通过 MCP 输入命令后，人必须能在 UI 中实时看到该输入及设备响应。
- AI 和人几乎同时输入时，系统必须保持单一顺序，不得出现 UI 和 MCP 看到的内容不一致。
- MCP 客户端使用旧 cursor 读取已清空后的输出。
- 多个 MCP 客户端同时写入或等待同一会话。
- 工作区首次初始化时缺少芯片型号、烧录地址或固件路径等关键字段。
- 工作区已有配置与当前连接到的硬件信息不一致。
- 工作区配置文件存在，但字段版本过旧或不完整。
- MCP Host 已连接但 Electron App 未启动或重启后端口变化。
- Agent 与 LinkTerm 的工具 schema 版本不一致。
- Agent 请求的高影响操作缺少明确参数来源或用户确认。
- J-Link 命令退出码为 0，但输出中存在明确 fatal error marker。
- 第三方依赖缺少许可证文件或归因信息。
- 旧 Qt 可执行文件仍在仓库中，但 v2 不得调用它完成验收。
- Electron 应用未运行时，MCP UI 配置或截图工具必须返回结构化失败证据。

## 7. 验收标准

- 干净环境下可执行 `npm test`，并通过终端、MCP、UI、许可证相关测试。
- 可执行 `npm run build` 完成 TypeScript 构建与静态资源复制。
- 可执行 `npm run validate:licenses` 完成第三方许可证校验。
- 终端 MCP 会话操作可在不加载 Qt 的情况下完成测试。
- 串口、SSH、本地 Shell 在测试中共享同一 session contract。
- 串口普通模式支持原始收发，串口终端模式支持终端渲染、统一交互规则和 `sendAndWait`。
- `sendAndWait` 能匹配跨 chunk 到达的命令完成标记。
- AI 通过 MCP 写入终端后，UI 能实时显示 AI 输入和设备输出。
- 人通过 UI 写入终端后，AI 能通过 MCP 读取人的输入和设备输出。
- AI 与人共同操作同一会话时，UI 和 MCP 看到的 transcript 顺序一致。
- MCP 能识别当前工作区，并在首次工程初始化时写入可复用的芯片、烧录、调试、RTT、串口等项目配置。
- 后续 debug、download、flash、terminal 操作能直接复用工作区配置；缺少关键字段时返回结构化提示。
- VS Code GitHub Copilot 可作为首要 MCP Host 完成工作区识别、终端读写、J-Link 调试下载、UI 取证和项目配置初始化。
- Agent 对接具备能力清单、schema 版本、工作区身份、断线重连和版本不匹配安全拒绝机制。
- J-Link 调试、下载、烧录、RTT、GDB 和 probe 相关能力通过独立 MCP surface 提供给 AI 使用。
- Debug MCP 工具注册在独立 surface 下，并能在无 backend 时安全拒绝 debug、下载、烧录等操作。
- License manifest 缺失必需归因时，校验必须失败。
- 若采用 J-Link MCP / `jlinkmcp` 仓库（https://github.com/daikw/JLinkMCP）作为实现参考，必须记录版本、许可证和实际借鉴范围。
- MCP UI 配置可改变运行中 UI 的语言、连接类型和字段值。
- MCP UI 截图可生成 PNG 证据文件，并返回结构化元数据。

## 8. 暂不纳入范围

- 完整 Tabby Angular 应用宿主集成。
- PTY 级别本地 Shell 行为完整实现。
- 依赖真实硬件的 J-Link/GDB/RTT 端到端验证。
- 直接复刻 J-Link MCP / `jlinkmcp` 仓库实现细节或未审查许可证即复制源码。
- 用旧 Qt 进程作为 Electron v2 的功能后端。
- 由 MCP 工具直接执行外部 J-Link、GDB、flash 或 VS Code task。

## 9. 需求来源

- `specs/005-electron-tabby-rewrite/spec.md`
- `specs/005-electron-tabby-rewrite/plan.md`
- `openspec/changes/add-ui-screenshot-control/proposal.md`
- `openspec/changes/add-ui-screenshot-control/specs/ui-automation-evidence/spec.md`
- `README.md`
