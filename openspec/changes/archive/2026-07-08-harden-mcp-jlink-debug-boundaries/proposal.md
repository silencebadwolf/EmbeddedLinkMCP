## Why

LinkTerm 已经具备 MCP runtime、J-Link backend 抽象、控制工作流和 agent runbook，但当前 MCP/J-Link/debug 链路仍存在工具完整性诊断、运行时身份、Commander/GDB 调用边界、参数来源和结构化错误/evidence 约束分散的问题。参考 JLinkMCP 仓库可借鉴最小 MCP 启动、stdio/SSE transport 切换和 Commander script orchestration 的设计思路，但其无 LICENSE 且直接从 handler 执行 `JLinkExe`，必须转化为 LinkTerm 自有安全边界内的规格化重构计划。

## What Changes

- 明确 LinkTerm MCP runtime 必须提供可机读的启动状态、transport 模式、metadata 新鲜度、核心工具完整性和工具集 hash，供 AI 在执行硬件操作前做轻量健康检查。
- 强化 MCP 工具注册契约：核心终端、profile、workflow、debug、UI、runbook/status 工具必须可诊断地注册；缺失核心工具时以结构化方式暴露，不让 AI 盲目 fallback 到外部 CLI。
- 规格化 J-Link Commander / GDB server 调用边界：所有 SEGGER 进程调用只能在 `src/jlink/` backend/runner 层发生，MCP surface、IPC、renderer、VS Code task 不得直接执行 J-Link/GDB/flash CLI。
- 将 JLinkMCP 参考仓库的可借鉴点限定为设计观察：transport 选择、最小 server bootstrapping、SSE 生命周期、backend 内部 Commander script orchestration；不得复制源码、固定参数、临时文件策略或 raw text result 模型。
- 强化 debug MCP 返回契约：J-Link/debug/flash 工具必须保持结构化 evidence、稳定 error code、origin/correlation/schemaVersion、高影响 `confirm=true` 门禁和敏感字段脱敏。
- 强化参数来源契约：J-Link target/interface/speed/firmware/baseAddress 等事实必须来自 control profile、用户确认或当前 MCP 请求，不得引入 hardcoded nRF52/SWD/speed/temp script/raw output 习惯。
- 明确验证策略：单元测试、集成测试、OpenSpec 校验、license 校验、build/lint/test；不要求、不允许在 proposal 阶段执行真实 J-Link、GDB、flash、probe 操作。

## Capabilities

### New Capabilities
- `mcp-runtime-tool-integrity`: Covers read-only MCP runtime identity, transport/metadata diagnostics, core tool completeness, and tool-set hash for AI startup health checks.
- `mcp-debug-boundary-hardening`: Covers MCP debug tool registration boundaries, structured evidence/error/confirmation contracts, and prohibition of direct J-Link/GDB/flash CLI fallback outside the backend.
- `jlink-command-runner-policy`: Covers backend-owned SEGGER Commander/GDB server execution policy, trusted executable resolution, script generation constraints, output bounding, and source-reference license limits.

### Modified Capabilities
- `mcp-agent-runbook`: Extend runbook/status guidance so AI clients receive startup-health and no-CLI-fallback guidance before dependent debug/flash operations.
- `workspace-control-profile`: Clarify that J-Link/debug/flash parameters used by workflows and backend calls come from profile/request/user-confirmed facts rather than hardcoded reference-repo defaults.

## Impact

- Affected code areas for later implementation:
  - `src/mcp/server.ts`, `src/mcp/registry.ts`, `src/mcp/tool-set.ts`, `src/mcp/runtime-diagnostics.ts`, `src/mcp/runtime-metadata.ts`
  - `src/mcp/surfaces/agent-runbook/*`, `src/mcp/surfaces/debug/*`, `src/mcp/surfaces/control-workflow/*`
  - `src/jlink/segger-command-runner.ts`, `src/jlink/jlink-adapter.ts`, `src/jlink/errors.ts`, `src/jlink/types.ts`
  - tests under `tests/unit/mcp/`, `tests/unit/jlink/`, and relevant integration boundary tests
- MCP API impact:
  - Existing tool names should remain stable.
  - `get_app_status` / runbook evidence may gain stricter required fields for runtime/tool-set diagnostics.
  - Debug and workflow evidence may gain optional structured diagnostics while preserving existing fields.
- Dependencies:
  - No new runtime dependency expected.
  - JLinkMCP remains design-only reference because it has no declared LICENSE; no code import, vendoring, or substantial rewrite from that source.
- Systems:
  - Strengthens LinkTerm's ownership boundary: AI hardware operations stay inside LinkTerm MCP + J-Link backend abstractions, with no terminal/VS Code task/direct CLI fallback.
