## Why

AI clients can still misdiagnose LinkTerm as having no terminal command send interface when they rely on a partial host/bridge tool view instead of LinkTerm's runtime status and runbook. LinkTerm already registers `write_to_session` and `send_and_wait`, but the startup guidance and status snapshot do not make terminal command capability explicit enough for robust cross-host use.

This causes avoidable detours such as inventing a separate bridge write path or implying that LinkTerm only supports reading session transcripts.

## What Changes

- Add explicit terminal command capability guidance to initialize instructions and the full agent runbook.
- Add a structured `terminalCommandTools` section to `get_app_status` so AI clients can machine-read the canonical tools for session listing/opening, command send, send-and-wait, status, and transcript readback.
- Tie the status section to core tool-set diagnostics so missing terminal command tools are reported as unavailable instead of being silently assumed.
- Add regression tests that prove the runtime advertises `write_to_session`, `send_and_wait`, and `read_from_session` as the supported terminal command path.

## Scope

In scope:
- `src/mcp/surfaces/agent-runbook/`
- Unit tests for runbook/status/tool descriptions
- OpenSpec delta spec for `mcp-agent-runbook`

Out of scope:
- Adding new terminal transport behavior
- Changing `SessionManager`, `WriteQueue`, or transcript semantics
- Adding external serial CLI fallback
- Changing MCP client/host implementations outside LinkTerm

## Impact

- No new runtime dependency.
- MCP API remains backward compatible: `get_app_status` gains a new optional structured section.
- AI clients get a durable, runtime-generated answer to “how do I send terminal commands?” without relying on repository docs or partial bridge assumptions.
