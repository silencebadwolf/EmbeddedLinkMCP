# LinkTerm MCP 使用说明与维护指南

这份文档同时回答两个问题：AI 应当如何使用 LinkTerm MCP，以及维护者修改 MCP 行为后应当同步哪些说明。运行时事实以当前代码、MCP 返回值和测试为准；提示词负责帮助 AI 选择正确路径，但不能替代 Main 进程的强制边界。

## 1. 先理解运行模型

LinkTerm 的桌面界面、MCP direct server、localhost HTTP owner 和 stdio proxy 最终共享 Electron Main 持有的运行时状态。核心边界包括：

- `SessionManager`：会话创建、状态、读取和写入入口。
- `SerialSessionCoordinator`：跨人工 IPC、MCP、保存连接、完整工作区和控制工作流统一串口 create-or-reuse。
- `WriteQueue`：同一 Session 的人工输入和 AI 输入在这里排序。
- Transport：串口、SSH、local shell、RTT 等实际传输实现。
- Transcript：设备、人工、AI 和系统事件的共同证据流。
- `IJLinkBackend`：J-Link、RTT、烧录、CPU 和 GDB 操作的唯一后端抽象。
- Operation Admission、Activity 和 Audit：前者负责验证后的序列化/资源准入，后两者负责观察，不负责人工批准。

当前产品没有人工批准、Pause、Resume AI、Take Over 或按照输入来源互斥抢占终端的机制。通过 schema、运行时状态、资源和准入检查的 AI 操作会自动执行；旧客户端仍可携带 `confirm` 字段，但其值只是兼容元数据，不是授权条件。

## 2. AI 的推荐启动顺序

一个新的 MCP 连接应按下面的顺序开始：

1. 读取 MCP initialize instructions。客户端不应要求用户再次提醒它阅读说明书。
2. 调用 `get_app_status` 获取当前运行时、工具完整性、Session、就绪状态、串口端口、控制配置、可见 J-Link 探针和 UI 可用性。
3. 需要详细流程或已知工作区 `root` 时，调用 `get_agent_runbook({root?})`。
4. 如果 `get_app_status` 报告运行时代码陈旧，调用 `restart_mcp_runtime`，重启后重新调用 `get_app_status`。
5. 根据已有 Session、已知配置或工作区事实选择最小入口，不要先盲目发现或新建连接。

`get_app_status` 是只读状态工具，但“只读”不等于完全不访问设备枚举 API：它会执行一次串口端口枚举和 J-Link `probeDetect()`。它不会打开串口、连接目标芯片、修改硬件、写终端、烧录、擦除、复位、停核、启动 GDB 或截取 UI 屏幕。

推荐调用链：

```text
initialize instructions
  → get_app_status({ root? })
  → get_agent_runbook({ root? })（需要详细说明时）
  → 复用现有 Session / 使用工作区控制配置 / 条件性发现设备
```

## 3. 简单串口、活动 Session、工作区与控制配置如何选择

### 已有活动 Session

优先调用 `list_sessions` 或查看 `get_app_status.sessions`。如果已有兼容串口 Session，直接使用它的 `sessionId`，不要创建第二个连接。

串口 `open_session` 的真实语义是 create-or-reuse：

- 相同物理端口、完整配置一致，且 Session 为 `idle`、`opening` 或 `open`：返回已有 `sessionId`，`evidence.data.reused=true`。
- 同一端口的并发兼容请求：只实际打开一次，其余请求等待并复用结果。
- 相同物理端口但配置不同：返回 `SERIAL_SESSION_CONFLICT`，不创建第二个候选或错误 Tab。
- `closed` 或 `errored` Session：不会复用，可以在确认没有其他活动 Session 后重新打开。

完整串口身份由 Main 保管，包括规范化端口、波特率、模式、数据位、停止位、校验和流控默认值。AI 不需要在 Renderer 或 preload 侧复制这套判断。

### 简单的一次性串口

如果用户只需要临时串口，不必创建工作区：

```text
list_sessions
  → 已知端口/配置：open_session（create-or-reuse）
  → 未知配置：discover_serial_ports → open_session
  → read_from_session / write_to_session / send_and_wait
```

`discover_serial_ports` 是条件性的一次性发现工具。已有兼容 Session、用户明确给出端口，或工作区/控制配置已经保存串口事实时，不应再次枚举端口。

### 工作区与控制配置

工作区描述项目和设备事实，不是 MCP/Agent 的全局配置：

- `<root>/.linkterm/config.json`：工作区配置，由 `init_workspace`、`get_workspace_config`、`update_workspace_config` 管理。
- `<root>/.linkterm/control-profile.json`：串口、J-Link、固件、RTT 等控制事实，由 `get_control_profile`、`inspect_control_profile`、`activate_control_profile` 和 `run_control_workflow` 使用。

知道 `root` 时，先读取现有事实，不要重新猜测端口、芯片、接口、速度、固件或地址。`activate_control_profile` 是非破坏性激活入口，但可能打开配置的串口并连接 J-Link；它不会烧录、擦除、复位、停核或启动 GDB。只需要芯片连接时使用 `connect_control_profile_chip`，不要顺带打开观察 Session。

App 保存的连接记录和工作区卡片不是一个通用 MCP 列表工具。MCP 可以看到 Main 中的活动 Session，也可以在已知 `root` 下读取工作区/控制配置；说明书不能声称 AI 能枚举所有 App-only 保存记录。

## 4. 人和 AI 如何共享终端

人工输入从 `session:write` IPC 进入 `SessionManager.write({origin:'human'})`；AI 输入从 MCP 工具进入 `SessionManager.write({origin:'ai'})`。两者进入同一个 Session、WriteQueue、Transport 和 Transcript。

因此：

- 人和 AI 可以同时观察、同时输入。
- AI 运行不能禁用人工键盘、抢焦点或宣称独占 Session。
- Activity Center 打开或关闭不改变终端所有权。
- 正常写入按队列排序；人工主动 Ctrl-C/abort 使用既有 high-priority 通道，可优先于尚未执行的普通写入。
- `close_session` 关闭的是双方共享的底层 transport。除非用户明确要求关闭，或创建它的工作流明确负责销毁，否则 AI 不应随意关闭共享 Session。

Transcript 的 `origin` 用于审计和渲染，不是互斥或权限标记。人工和 AI 都能在同一终端看到设备输出与共同输入历史。

## 5. write/read/send_and_wait 的准确语义

### write_to_session

`write_to_session` 把字节写入共享队列，返回 `bytesWritten`。它只能证明 LinkTerm 主机侧接受并写出了这些字节，不能证明设备固件已经读取、解析或执行命令。

### read_from_session

`read_from_session({sessionId, cursor})` 从指定 cursor 之后读取 Transcript 事件，并返回新的 cursor。`cursor=0` 表示从当前仍可见的最早事件开始。`truncated=true` 表示更早事件已经被环形缓冲淘汰，应使用返回的 `oldestAvailableSequence` 恢复到当前可读边界。

### send_and_wait

`send_and_wait` 的当前行为是：

1. 记录写入前 cursor。
2. 只写一次 payload，可按规则追加换行并过滤回显。
3. 在有限的 `settleMs` 内收集 device-origin 输出。
4. 到 settle 边界后返回 `reason='settled'`。

completion marker 只用于返回 `matchedMarkerIndex`，不是成功门槛，也不会让工具提前结束。`timeoutMs` 仍是兼容别名；同时提供时 `settleMs` 优先。

```text
send_and_wait(write once + bounded settle)
  → 检查 hasDeviceOutput / receivedBase64 / cursorBefore / cursorAfter
  → read_from_session(cursor) 获取后续或完整证据
  → 由输出内容和上下文决定下一步
```

`hasDeviceOutput=false` 仅表示该时间窗口没有观察到非回显设备字节。它不证明设备死机，也不证明命令完成，更不允许 AI 自动重复状态改变命令。空 settle 不会把 Session 自动标记为 AI-unresponsive，后续写入仍然允许。

`DEVICE_UNRESPONSIVE` 仍保留在错误类型和兼容翻译中，但当前正常的空 settle 路径不会设置该状态。遇到旧运行时或显式注入状态返回此错误时，应先读取 Transcript、检查 Session/设备事实，再决定是否由用户重新打开 Session；不要直接循环发送。

## 6. J-Link、RTT、烧录和后台工作流

MCP 不应绕过 LinkTerm 调用外部 `JLink.exe`、SEGGER Commander、GDB、串口 CLI 或 VS Code task。MCP 工具通过 `IJLinkBackend` 和现有管理器执行操作。

通过既有检查的高影响操作会自动执行，包括烧录、擦除、复位、GDB server 和高层控制工作流。不存在人工批准按钮。AI 必须在调用前确认参数和意图，在调用后观察真实 backend、Activity、Audit 和工作流证据。

长时间操作使用后台 Job：

```text
run_control_workflow({ execution: { mode: 'background' }, ... })
  → get_control_workflow_job_status({ jobId })
  → read_control_workflow_job({ jobId })
  → cancel_control_workflow_job({ jobId })（确需取消时）
  → cleanup_control_workflow_jobs(...)（终态/过期记录清理）
```

MCP Host 请求超时不等于硬件失败。只要后台 Job 已创建，它就在 LinkTerm 内继续运行；应按 `jobId` 恢复状态和证据。不能因为客户端 deadline 到期就重复烧录、擦除、复位、attach 或启动 GDB。

连续 RTT 日志优先使用 `open_rtt_log_session({root})`，它从控制配置准备 J-Link/GDB/RTT 并打开 App 可见 Session。日志静默或只有 SEGGER banner 时，先调用 `diagnose_rtt_log_session`，不要把静默直接解释为需要重刷固件。RTT 写入返回的 `bytesWritten` 同样只是主机侧事实；需要 device-origin 输出或诊断证据才能声称固件消费了 down-channel 数据。

## 7. Activity/Audit 与硬件成功证据

Activity Center 和 Audit 是观察面，不是执行授权面。它们展示调用、进度、结果、错误和证据引用，但不提供 approve、deny、continue、pause、resume 或 take-over 操作。

以下内容不足以单独证明硬件成功：

- MCP 请求返回 `success=true`，但结果只表示请求或 Job 已接受。
- `bytesWritten`。
- 计划步骤或估算百分比。
- 旧 Session 输出、旧 Job 记录或外部工具日志。
- 仅发现 J-Link USB 探针，但没有目标连接/backend 证据。

成功结论必须引用与本次操作关联的新鲜证据，例如真实 backend 返回、验证读回、最终工作流步骤、目标寄存器/状态、device-origin 串口/RTT 输出或带 correlation/job/session 标识的 Activity/Audit 记录。

## 8. 常见错误和禁止的重试方式

| 结果 | 正确处理 | 禁止行为 |
| --- | --- | --- |
| `SERIAL_SESSION_CONFLICT` | `list_sessions`/`get_app_status`，比较现有与请求配置，使用兼容 Session 或由用户决定关闭/改配置 | 对同一端口循环 `open_session` |
| `NOT_OPEN` / `SESSION_CLOSED` | 检查 Session 列表；只有没有兼容活动 Session 时才重新打开 | 不看状态直接创建多个 Tab/Session |
| `send_and_wait` 空 settle | 读取新鲜 Transcript，结合命令和设备上下文判断 | 自动重复发送状态改变命令 |
| `QUEUE_FULL` | 等待队列排空后有限重试普通写入 | 并行洪泛写入 |
| `DEVICE_UNRESPONSIVE` | 读取 Transcript/状态，识别旧运行时或显式恢复要求，必要时让用户重新打开 | 把它等同于已证实硬件死机并持续发送 |
| MCP Host timeout | 按 `jobId` 查询后台状态和证据 | 重复 flash/erase/reset/attach/GDB start |
| `NO_BACKEND` / 探针不可见 | 报告缺少 backend/设备证据，检查 LinkTerm 状态和物理条件 | 宣称连接/烧录成功，或绕过 LinkTerm 跑外部 CLI |
| `INVALID_STATE` 且代码陈旧 | `restart_mcp_runtime`，然后重新 `get_app_status` | 在旧进程上继续硬件操作 |

## 9. 提示词的四个层次和源码位置

| 层次 | 用户/AI 何时看到 | 真源 |
| --- | --- | --- |
| Initialize instructions | MCP initialize 响应 | `src/mcp/surfaces/agent-runbook/runbook.ts` 的 `createAgentRunbookInstructions()` |
| 详细运行说明书 | `get_agent_runbook` | `RUNBOOK_WORKFLOWS`、`SAFETY_RULES`、`createAgentRunbook()`、`renderRunbookMarkdown()` |
| 当前状态与推荐动作 | `get_app_status` | `src/mcp/surfaces/agent-runbook/tools.ts` |
| 动作局部说明 | `tools/list` 的 description | 各 `src/mcp/surfaces/*/tools.ts` 注册点 |

四层应当一致，但信息密度不同：initialize 只保留启动和不可遗漏的规则；详细 runbook 解释完整流程；结构化数据供 AI 稳定解析；description 只说明当前工具的真实动作、证据和风险。

## 10. direct server、HTTP owner 和 stdio proxy

Main-owned direct MCP server 在 `src/mcp/server.ts` 的 `createMcpServer()` 中注入 initialize instructions。

stdio proxy 在 `src/mcp/stdio-proxy.ts` 中使用同一个 `createAgentRunbookInstructions()`。它把 `tools/list` 和 `tools/call` 转发给现有 localhost HTTP owner，所以 App 和外部 Agent 仍然使用同一个 Main 运行时。

`createMcpProxyServer()` 是不依赖真实 stdin/HTTP 的构造接缝，用于内存 MCP client 验证 initialize 和转发契约；`startMcpStdioProxy()` 继续负责真实 HTTP client、Bearer header、stdio transport 和停机顺序。

任何运行时提示修改都要同时验证 direct 和 proxy initialize。只检查源字符串不足以证明 MCP Host 实际收到了说明。

## 11. Agent integration 配置保存什么

Agent integration 由 `src/core/agent-integrations/agent-integration-manager.ts` 和 `launch-config.ts` 生成：

- VS Code/Cursor/Claude Desktop JSON：`command`、`args`、`env` 和客户端所需 transport shape。
- Codex stdio TOML：`[mcp_servers.linkterm]` 和 `[mcp_servers.linkterm.env]`。
- Codex HTTP TOML：owner `url` 和 `bearer_token_env_var` 引用。

这些文件不保存 LinkTerm MCP Agent Runbook、initialize instructions 或另一份 system prompt。说明书由 LinkTerm 打包代码在 MCP 连接时提供。这样可以避免不同客户端各自漂移，也避免更新说明书时重写用户配置。

## 12. 修改说明书时的同步清单

| 修改内容 | 必查文件 | 定向测试 |
| --- | --- | --- |
| Initialize 核心规则 | `src/mcp/surfaces/agent-runbook/runbook.ts` | `tests/unit/mcp/agent-runbook.test.ts`、`stdio-proxy.test.ts` |
| 详细 Markdown/结构化 workflow | `runbook.ts`、`agent-runbook/tools.ts` | `agent-runbook.test.ts` |
| 串口/终端动作语义 | `terminal/tools.ts`、Session/Coordinator 真源 | `tool-descriptions.test.ts`、`terminal-tools.test.ts` |
| 工作流超时/Job 指引 | `control-workflow/tools.ts`、`job-manager.ts` | `tool-descriptions.test.ts`、`control-workflow-tools.test.ts` |
| J-Link/RTT/烧录描述 | debug/RTT tools 与 `IJLinkBackend` | debug、RTT、tool-description tests |
| Agent 配置边界 | `agent-integration-manager.ts`、`launch-config.ts` | Agent integration/launch-config tests |
| 规格 | `openspec/specs/` 与相关 active change | `openspec validate <change> --strict` |
| 编译后运行时 | `dist/main`、`dist/renderer` | `pnpm run build`，重启后 `get_app_status` |

维护步骤：

1. 先从代码和执行流确认行为，不从旧 README 猜测。
2. 更新独立 OpenSpec change。
3. 先写失败测试并看到正确 RED。
4. 修改对应生成器或 description，不在 Agent 配置中复制提示词。
5. 验证 direct initialize、proxy initialize、`get_agent_runbook` 和 `tools/list`。
6. 运行全量测试、lint、build、license、OpenSpec、GitNexus/PDG/taint 检查。
7. 重新构建并重启运行时；如果 `get_app_status` 报告 stale code，先执行运行时重启。

## 13. MCP Host 限制与 Main 强制边界

不同 MCP Host 对 server instructions 的展示、上下文保留和遵循程度可能不同；工具 description 也可能被裁剪或按需加载。因此：

- 不能假定 AI 一定先调用 `get_agent_runbook`。
- 不能把关键安全/一致性只写在 prompt 中。
- 串口复用、写入排序、schema 校验、运行时新鲜度、准入、backend 所有权和证据净化必须继续由 Main/核心代码执行。
- `get_app_status` 的 tool-set diagnostics 可用于发现 Host 只暴露了部分工具；缺工具时应修复/重启运行时，不使用外部 CLI 兜底。

## 14. 无真实硬件副作用的验证方法

说明书改动可以全部使用内存或 Fake 依赖验证：

- direct MCP：`createInMemoryMcpTransportPair()`。
- stdio proxy：`createMcpProxyServer()` 加内存 client/server transport。
- 串口：`MockTransport` 和 `SerialDiscovery({listFn})`。
- J-Link：`FakeJLinkBackend` 或 `NullJLinkBackend`。
- Agent 配置：临时目录和内存/临时文件桥。

自动验证不得打开真实 COM 口、连接探针/目标、连接 RTT、启动真实 GDB server、烧录、擦除、复位、停核或执行调试命令。测试通过证明说明书与模拟/代码契约一致，不等于真实硬件已经成功执行任何操作。
