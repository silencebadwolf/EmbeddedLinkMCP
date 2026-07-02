## Design

Add a small runtime-control MCP surface with one tool: `restart_mcp_runtime`.

The registry keeps the existing stale guard for `state-affecting` tools. A new tool definition flag, `allowWhenRuntimeStale`, lets a state-affecting tool bypass only the stale-code guard. The flag defaults to false, so existing tools are unchanged.

`restart_mcp_runtime` requires `confirm=true`, reports whether a restart was scheduled, and returns before the process exits. The Electron owner implementation calls `app.relaunch()` and schedules `app.exit(0)` after a short delay so the MCP response can be flushed. Test and non-Electron runtimes can inject a restart scheduler.

The tool does not touch serial sessions, probes, flash, reset, GDB, or RTT directly. It only restarts the runtime process. After restart, callers must run `get_app_status` again and then use the normal control workflow.

## Non-Goals

- Do not auto-restart on every stale status read.
- Do not bypass stale checks for flash, reset, serial writes, probe operations, GDB, or UI control.
- Do not implement OS-level process scanning or external task killing inside MCP.
