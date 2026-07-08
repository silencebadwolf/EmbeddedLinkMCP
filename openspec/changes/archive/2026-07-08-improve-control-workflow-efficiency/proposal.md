## Why

LinkTerm 的高层硬件工作流已经能统一执行 profile 读取、串口复用、J-Link 连接、烧录、复位和串口观察，但失败时仍把较多 SEGGER 文本和 backend 状态留给 AI 自行判断，导致重复探测、重复配置和多轮 token 消耗。

本变更把常见失败压缩成稳定分类和机器可执行 nextActions，并为 raw flash 场景引入安全速度策略，让 AI 优先走确定性快速路径，而不是反复尝试低层工具。

## What Changes

- 扩展 `run_control_workflow` 输出，增加稳定的工作流失败分类、原因和建议动作。
- 为常见 J-Link/SEGGER 失败输出提供分类，包括 target 问题、probe 问题、verify 失败、RAM preserve / prepare programming 失败、命令超时和未实现能力。
- 强化 `nextActions`，允许携带建议工具、参数补丁和是否需要确认，减少 AI 猜下一步。
- 为 raw binary flash 增加安全速度策略：当 profile 使用 `speedKHz: "auto"` 且执行烧录工作流时，优先使用安全速度而非让 SEGGER 自动升到高风险速度。
- 更新工具描述和相关测试，明确 AI 应优先使用高层 workflow，而不是拆散调用低层 J-Link/串口工具。

## Capabilities

### New Capabilities
- `control-workflow-efficiency`: Covers deterministic failure classification, safe J-Link speed selection, and machine-readable next actions for high-level control workflows.

### Modified Capabilities
- `workspace-control-profile`: Clarify how `jlink.speedKHz: "auto"` is interpreted by high-level raw flash workflows.

## Impact

- Affected code:
  - `src/mcp/surfaces/control-workflow/*`
  - `src/jlink/segger-command-runner.ts` error classification consumers if needed
  - related unit tests under `tests/unit/mcp/` and `tests/unit/jlink/`
- Affected MCP API:
  - `run_control_workflow` evidence gains additional optional structured fields.
  - Existing fields remain backward compatible.
- No new runtime dependencies.
- No change to the LinkTerm MCP ownership boundary; AI still must not call J-Link, GDB, J-Flash, serial CLI, or VS Code tasks directly.
