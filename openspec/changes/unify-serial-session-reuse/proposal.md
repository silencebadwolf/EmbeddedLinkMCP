## Why

LinkTerm shares one `SessionManager` between human and AI callers, but each serial entry point still
creates sessions independently. Opening an already-used saved workspace can therefore create a
second tab that immediately fails because the first session already owns the physical port.

## What Changes

- Add one Main-owned serial session coordinator shared by MCP, renderer IPC, saved connections,
  saved workspaces, control-profile activation, and control workflows.
- Reuse an idle, opening, or open serial session when its complete normalized serial configuration
  matches the requested configuration.
- Reject a second configuration for the same active physical port with a stable
  `SERIAL_SESSION_CONFLICT` error, without creating an errored tab.
- Serialize concurrent opens for the same physical port so equivalent requests create at most one
  session while different ports remain independent.
- Guide AI callers to inspect current sessions before opening one, while keeping Main-side reuse as
  the authoritative guarantee.

## Capabilities

### New Capabilities

- `serial-session-reuse`: Defines cross-entry serial identity, reuse, conflict, concurrency, and
  renderer-observable behavior.

### Modified Capabilities

- `mcp-agent-runbook`: The serial observation runbook prefers an existing compatible session before
  requesting a new one.

## Impact

Expected implementation areas include the core session layer, Main IPC session/open helpers, MCP
terminal and control-profile/workflow surfaces, MCP server dependency wiring, stable error codes,
and focused unit/integration tests. No serial
protocol, transport write ordering, approval policy, hardware driver, or destructive hardware
operation is changed.
