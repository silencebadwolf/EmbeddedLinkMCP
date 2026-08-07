## Context

LinkTerm v2 当前 13 个阶段已完成，MCP server 在 Electron main process 内注册终端、workspace、control profile、control workflow、agent runbook/status、debug 和 UI surfaces。`createMcpServer()` 已经始终注册 debug/UI 工具，并通过 `NullJLinkBackend`、`get_app_status`、`get_agent_runbook`、runtime diagnostics 和 tool-set diagnostics 暴露部分健康状态。

J-Link/debug 相关生产代码的关键边界是：MCP surface 只调用 `IJLinkBackend`；真实 SEGGER Commander / GDB server 进程控制集中在 `src/jlink/segger-command-runner.ts` 和 `JLinkAdapter` 内；高影响工具通过 `confirm=true` 门禁；错误通过 `JLinkError` → `ToolErrorCode` 翻译；二进制 payload 在 MCP 边界有 16 MiB cap。

参考仓库 JLinkMCP（`<reference-repos>/JLinkMCP`，commit `53d9085028048b4c8b08adab5dbb8a575e3ad21b`）是一个无 LICENSE 的 Go `mcp-go` 最小 server。它可作为设计观察：简洁 MCP bootstrapping、stdio/SSE transport switch、SSE graceful shutdown、Commander script orchestration。但它直接在 tool handler 中创建临时 script 并执行 `JLinkExe`，使用 hardcoded nRF52/SWD/speed/raw text output；这些实现与 LinkTerm 安全边界冲突，不能复制或改写进 LinkTerm。

## Goals / Non-Goals

**Goals:**
- 将 MCP/J-Link/debug 重构规划限定在 LinkTerm 自有 MCP registry、runtime diagnostics、agent runbook/status、debug surface、control workflow、control profile 和 `src/jlink/` backend/runner 边界内。
- 让 AI 在任何硬件相关动作前能读取轻量、只读、结构化 runtime/tool-set 状态，确认 owner/proxy/stdio 模式、metadata 新鲜度和核心工具完整性。
- 规范 debug surface 的行为：只调用 `IJLinkBackend`，保留结构化 evidence/error/correlation/schemaVersion/origin 和 high-impact confirm gate。
- 规范 Commander/GDB server runner：只接受可信绝对 executable path，shell disabled，bounded output，redacted diagnostics，唯一临时脚本/参数文件，不能依赖 PATH 或 hardcoded reference defaults。
- 将 JLinkMCP 参考点记录为设计借鉴，不引入代码、依赖、license 归因或实现表达。
- 为后续实现提供可测试任务拆分，优先单元/集成 fake backend/runner，不要求真实 J-Link 硬件。

**Non-Goals:**
- 不在 proposal 阶段修改源码。
- 不实现新的外部 MCP server，也不引入 Go/mcp-go 依赖。
- 不复制、翻译复制或实质改写 JLinkMCP 源码。
- 不让 MCP surface、IPC、renderer、VS Code task 或测试 fixture 直接执行真实 J-Link/GDB/flash CLI。
- 不改变已公开的核心 MCP tool names，除非后续单独提案说明兼容策略。
- 不在本变更中完成所有未实现 debug backend 能力；`complete-jlink-debug-backend` 仍负责具体 backend 功能补齐，本变更负责边界、诊断和契约硬化。

## Decisions

### Decision 1: 以 LinkTerm runtime status 作为 stdio/SSE 借鉴点，而不是引入 SSE server

JLinkMCP 的 stdio/SSE switch 表明 AI client 需要区分本地 stdio 与远程/长生命周期 server 状态。LinkTerm 已有 Electron owner runtime、stdio proxy、HTTP runtime metadata 和 `get_app_status`，因此不新增 SSE transport；改为强化 `RuntimeDiagnostics` 与 `ToolSetDiagnostics`，让 status evidence 明确 transport mode、runtime identity、metadata path/url/freshness、核心工具完整性和 tool-set hash。

Alternative considered: 在 LinkTerm MCP 中新增 SSE transport。拒绝原因：当前架构已有受控本机 HTTP runtime + stdio proxy；新增 SSE 会扩大攻击面和实现范围，且不是当前问题的必要修复。

### Decision 2: 核心工具完整性由 registry 记录，不靠 README 或 hardcoded client 假设

继续使用 registry 统一记录工具名，并由 `buildToolSetDiagnostics()` 输出 expected/core/missing/hash。实现阶段应补足测试，覆盖 fully-capable runtime、缺少 optional managers 的 runtime、stdio proxy/owner 模式，以及任何新核心工具加入后的 hash 稳定性。

Alternative considered: 让 AI 调用 `tools/list` 后自行判断。拒绝原因：AI 端推理不稳定，且不能表达 LinkTerm 认为“核心完整”的定义。

### Decision 3: MCP debug surface 只做 schema/evidence/error 投影

`src/mcp/surfaces/debug/*` 不应包含 CLI 路径解析、script 生成、spawn、GDB server 启动或 SEGGER 文本解析。所有此类行为必须在 `src/jlink/` backend/runner 内完成，MCP surface 只负责 Zod schema、confirm gate、base64 边界转换、`ToolError` 翻译和 evidence 投影。

Alternative considered: 借鉴 JLinkMCP 在 handler 中直接执行 Commander，快速修复功能。拒绝原因：违反 PROJECT_REQUIREMENTS §4.4/§4.6/§5.1，也会破坏测试隔离和安全审计。

### Decision 4: Commander script orchestration 只能作为 backend 内部策略

后续需要 SEGGER Commander 时，`DefaultJLinkCommanderClient` 可以继续使用命令文件/参数文件策略，但必须满足：可信绝对路径、唯一临时文件、shell disabled、bounded stdout/stderr、serial number redaction、timeout/AbortSignal、domain error classification、清理临时文件、并发隔离。不得引入 JLinkMCP 的固定 temp filename、hardcoded nRF52/SWD/speed 或 raw text result。

Alternative considered: 直接让 JLinkAdapter 拼 command list 并调用 generic runner。拒绝原因：会让 adapter 逐步膨胀并分散安全检查；runner/client 层应是唯一 Commander/GDB process boundary。

### Decision 5: 参数来源必须可追溯

J-Link target/interface/speed、firmware、baseAddress、verify、RTT/GDB 参数必须来自 control profile、用户确认或本次 MCP 请求，并在 evidence/diagnostics 中能区分“profile-derived/request-derived/defaulted”。默认值只能是 LinkTerm 明确声明的安全默认，不能来自参考仓库样例。

Alternative considered: 为快速体验设置 nRF52/SWD/4000 等默认值。拒绝原因：会在真实硬件上造成错误操作风险，并与 workspace-control-profile 的复用事实来源相冲突。

### Decision 6: 高影响门禁和错误码保持先于 payload 解码/后端调用

`flash_download`、`flash_write`、`flash_erase`、`cpu_reset`、`gdb_server_start` 继续要求 `confirm=true`。对二进制高影响工具，confirm gate 必须先于 base64 decode；缺确认时 backend ledger 不应记录调用。新增或重构时必须通过 fake backend/runner 测试证明。

Alternative considered: 统一先 parse/decode 再校验 confirm。拒绝原因：会让恶意 payload 在未确认时消耗内存/CPU，并违反已有 Phase 12 contract。

### Decision 7: 参考仓库事实进入设计文档，不进入运行时代码

JLinkMCP 的 commit、路径、无 LICENSE 风险和可借鉴/不可借鉴点应保留在 proposal/design/specs 中；实现代码中不得出现复制片段、相同临时脚本结构或 Go/mcp-go 依赖。若未来要引用其他开源实现，必须先完成 license 审查并更新第三方归因。

Alternative considered: 将参考仓库作为测试 fixture 或示例代码导入。拒绝原因：无 LICENSE，且没有必要进入分发物。

## Risks / Trade-offs

- **Risk: 与现有 active OpenSpec changes 重叠** → Mitigation: 本 change 只定义边界、诊断和契约硬化；具体 backend 功能补齐仍由 `complete-jlink-debug-backend` 承担，workflow failure 分类仍由 `improve-control-workflow-efficiency` 承担。
- **Risk: tool-set expected list 变更导致测试脆弱** → Mitigation: 用集中常量和 hash snapshot 测试；新增核心工具必须同步 expected list 和 runbook/status spec。
- **Risk: 过度约束导致 backend 难以适配 SEGGER 版本差异** → Mitigation: runner policy 约束安全边界，不规定具体 Commander 文本；解析失败仍可返回 bounded redacted diagnostics。
- **Risk: runtime metadata stale/fresh 判断误导 AI** → Mitigation: status evidence 同时返回 identity、pid、startedAt、metadata age/url/path/fresh 字段；危险操作仍由后端状态和 confirm gate 决定。
- **Risk: 用户误以为 JLinkMCP 可复制** → Mitigation: proposal/design/spec 明确 no-license/no-copy；任务中加入 license/reference audit。

## Migration Plan

1. 完成本 OpenSpec change 的 proposal/design/specs/tasks 并运行 `openspec validate`。
2. 实现阶段先补测试：runtime/tool-set diagnostics、debug surface no-direct-spawn boundary、confirm-before-decode、runner path/temp/output policy、profile-derived parameter provenance。
3. 分阶段修改 `src/mcp/*` 和 `src/jlink/*`，每阶段只处理一类边界或诊断，不顺手实现未规划 debug 功能。
4. 使用 fake backend/runner 验证，不运行真实 J-Link/GDB/flash/probe 操作。
5. 完成后运行 targeted tests，再运行 `pnpm run lint`、`pnpm test`、`pnpm run build`、`pnpm run validate:licenses`、`openspec validate --all`。
6. 若出现回归，回滚对应 runtime/status/runner policy 改动；由于公开 tool names 不变，预计无需数据迁移。

## Open Questions

- `get_app_status` 中 runtime metadata freshness 是否需要固定最大 age 阈值，还是继续由 provider 判定 `fresh`？
- `ToolSetDiagnostics.hash` 是否应作为 public compatibility signal 写入 runbook initialize instructions，还是仅保留在 `get_app_status` evidence？
- control profile 参数 provenance 是否需要在 profile schema 中持久化，还是仅在 workflow/debug evidence 中临时标注？
