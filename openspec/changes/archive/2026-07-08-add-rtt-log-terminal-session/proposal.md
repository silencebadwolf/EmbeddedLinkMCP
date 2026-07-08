## Why

LinkTerm 已经具备 J-Link RTT 的一次性 `rtt_read/search/clear` 能力，但这些结果只作为 debug evidence 返回，无法在 UI 中像串口一样持续观察日志。嵌入式调试时用户更需要一个实时、可滚动、可由 AI 读取 cursor 的 RTT 日志终端，而不是反复手动轮询 `rtt_read`。

## What Changes

- Add a LinkTerm-managed RTT log terminal session that presents RTT up-channel bytes as a read-only terminal-like tab in the renderer.
- Reuse existing `SessionManager`, `TranscriptBuffer`, transcript subscription, and xterm rendering for the UI path, while keeping RTT ownership in the J-Link backend.
- Add explicit RTT log session metadata so AI/UI can distinguish RTT log sessions from serial/SSH/local shell sessions.
- Add safe lifecycle behavior: the session opens only from an existing connected probe and RTT connection, polls bounded chunks, appends transcript events, and closes cleanly without leaking timers/listeners.
- Add MCP/IPC entry points for opening and closing RTT log sessions without bypassing `IJLinkBackend` or directly touching SEGGER/GDB/socket APIs from MCP/renderer.
- Keep existing one-shot `rtt_read/search/clear` debug tools intact for structured debug evidence.

## Capabilities

### New Capabilities
- `rtt-log-terminal-session`: Covers long-lived RTT log sessions, UI terminal rendering, AI-readable transcript cursors, bounded polling, lifecycle cleanup, and separation from existing one-shot debug evidence.

### Modified Capabilities
- `mcp-agent-runbook`: Extend AI guidance/status to explain when to use an RTT log terminal session versus one-shot `rtt_read/search/clear` tools.

## Impact

- Affected code areas:
  - `src/shared/` for session metadata/API shape updates.
  - `src/core/session/` or a narrow adjacent module for the RTT log session implementation.
  - `src/main/ipc/` for renderer-openable RTT log session entry points.
  - `src/mcp/surfaces/` for MCP open/status guidance and possibly a dedicated RTT log session tool.
  - `src/renderer/` for tab labeling/icons and RTT log open controls.
  - `tests/unit/` and `tests/integration/` for backend polling, transcript behavior, IPC/MCP contracts, and renderer hydration.
- API impact:
  - Additive only. Existing serial/SSH/local-shell session creation and existing debug tools remain compatible.
  - New session type/metadata must be explicit enough that saved connection profiles do not treat RTT logs as ordinary user-created serial/SSH/local-shell connections.
- Dependencies:
  - No new runtime dependency expected.
- Systems:
  - RTT log bytes become terminal-visible evidence tied to transcript cursors, but SEGGER/GDB/socket access remains exclusively behind LinkTerm J-Link backend abstractions.
