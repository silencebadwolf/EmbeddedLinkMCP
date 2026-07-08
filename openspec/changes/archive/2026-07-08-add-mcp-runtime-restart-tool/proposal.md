## Why

When LinkTerm MCP detects stale compiled artifacts, it correctly blocks state-affecting tools before hardware operations. However, the only recovery path is a textual instruction to restart the runtime. Agents then fall back to ad hoc process discovery and manual commands, which is slow and easy to get wrong under pressure.

The runtime needs a first-class recovery tool that is safe to call when code is stale, does not touch hardware, and makes the next correct step machine-readable.

## What Changes

- Add an MCP `restart_mcp_runtime` tool that schedules a LinkTerm runtime restart after returning structured evidence.
- Keep stale-runtime protection for all existing state-affecting tools.
- Allow only explicitly marked runtime-control tools to run when runtime diagnostics report stale code.
- Include `restart_mcp_runtime` in the core MCP tool set and stale-runtime recommended next actions.

## Impact

- Affected code areas:
  - MCP registry stale guard
  - MCP server/runtime tool registration
  - main-process runtime restart integration
  - agent runbook/app status recommendations
- Behavior impact:
  - Agents can recover stale runtime state with one MCP call instead of manual PID/process commands.
  - Hardware operations remain blocked until the fresh runtime starts.
