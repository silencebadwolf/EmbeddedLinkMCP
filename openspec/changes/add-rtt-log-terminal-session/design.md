## Context

LinkTerm 当前已经实现 J-Link RTT 的 backend-owned telnet client，并通过 `rtt_connect`、`rtt_read`、`rtt_search`、`rtt_clear` 暴露一次性 MCP debug tools。现有 UI terminal 只展示 `SessionManager` 管理的 serial/SSH/local-shell transcript，RTT debug evidence 不会进入 terminal transcript，这是已有安全边界。

用户下一步需要“RTT 日志的终端功能”：在人类 UI 中实时观察 RTT 日志，同时 AI 也能像读取串口 transcript 一样按 cursor 读取同一份日志证据。这个能力跨 `src/jlink/`、`src/core/session/`、`src/main/ipc/`、`src/mcp/` 与 `src/renderer/`，需要一个明确 seam，避免让 renderer/MCP 直接轮询 SEGGER/GDB socket。

## Goals / Non-Goals

**Goals:**
- Provide a long-lived RTT log session that appears as a read-only terminal tab and produces normal transcript cursor semantics.
- Keep SEGGER/GDB/socket access exclusively behind `IJLinkBackend`; renderer and MCP never touch RTT sockets or external CLI paths directly.
- Preserve existing one-shot `rtt_read/search/clear` debug tools and evidence contracts.
- Bound polling, memory, and output growth; close sessions without leaving timers, pending reads, or backend handles leaked.
- Make RTT sessions explicit in metadata so UI, MCP, and tests can distinguish them from serial/SSH/local-shell.

**Non-Goals:**
- No RTT down-channel write support in this slice. The RTT terminal is read-only; user keystrokes are ignored or blocked with a clear status.
- No new GDB/MI client and no direct `arm-none-eabi-gdb` integration.
- No automatic high-impact GDB server startup inside the RTT log session open path. A caller must provide an already connected probe with RTT connected, or use existing confirmed workflow/tooling first.
- No persisted saved connection profile for RTT logs; runtime sessions are transient.

## Decisions

### Decision 1: Model RTT logs as explicit `rtt-log` sessions, not as serial sessions

Add an explicit session kind/connection type for RTT log sessions rather than overloading `serial`, `ssh`, or `local-shell`. This keeps tab icons, labels, hydration, and future behavior honest: RTT is target debug output, not a COM port.

Alternative considered: append RTT bytes to a serial transcript. Rejected because existing specs require debug output to stay isolated from ordinary terminal evidence and because RTT reads consume a separate backend buffer.

### Decision 2: Use a small `RttLogSession` adapter over `IJLinkBackend.rttRead`

Implement a session-like module that owns a polling loop and appends backend-read bytes to its transcript as `device` data events. The module should be constructed with `probeId`, `channelIndex`, `pollIntervalMs`, `maxBytesPerRead`, and `IJLinkBackend` dependency. It must not import Electron.

This keeps the public surface deep: callers open/close/read the session through `SessionManager`, while polling, empty-read handling, timer cleanup, and backend error translation remain local to the RTT session implementation.

### Decision 3: Keep one-shot debug tools as debug evidence

`rtt_read/search/clear` remain debug surface tools with `debug_output` evidence. The RTT log terminal capability adds a streaming observation path; it does not change the semantics of the existing state-affecting `rtt_read` tool.

This avoids breaking AI clients that already use one-shot RTT reads for structured evidence or search.

### Decision 4: Add dedicated open entry points instead of extending generic session:create first

The initial open path should be a dedicated IPC/MCP action such as `rttLog:open` / `open_rtt_log_session`, not a new branch of the generic connection dialog schema. This avoids accidentally treating RTT logs as saved user connection profiles and keeps required debug preconditions visible.

The resulting session is still registered in `SessionManager`, appears in `session:list`, hydrates into the renderer, and can be read through existing transcript APIs.

### Decision 5: The RTT log terminal is read-only for now

The renderer should disable or ignore xterm `onData` for `rtt-log` sessions. If a user types into an RTT tab, no bytes are sent to `SessionManager.write` and no backend write path is invented.

Future RTT down-channel support can add an explicit backend method and UI affordance after the safety and target support are defined.

## Risks / Trade-offs

- **Consuming RTT bytes affects one-shot `rtt_read` callers** → Document that an active RTT log session owns the channel's read pointer; one-shot search/read should be used before opening the log session or against the log transcript after opening.
- **Polling loop can grow transcript too quickly** → Use bounded `maxBytesPerRead`, configurable poll interval with safe minimums, and rely on existing transcript ring buffer truncation.
- **Backend errors during polling can spam transcript** → Record one terminal error event and transition the RTT session to `errored` or `closed`; do not keep retrying indefinitely without explicit reopen.
- **Multiple RTT log sessions for the same probe/channel can race** → Reject duplicate active sessions for the same probe/channel or reuse the existing session; do not let two sessions consume the same RTT buffer.
- **UI generic terminal writes may accidentally call session.write** → Gate writes based on `connectionType === 'rtt-log'` in renderer or return structured `NOT_OPEN/INVALID_STATE` from the session write path.

## Migration Plan

1. Add OpenSpec requirements and validate them.
2. Implement in TDD slices: core RTT session behavior first, then main/MCP entry points, then renderer display/write gating.
3. Run targeted unit tests for core/session, MCP debug/RTT entry, and renderer tab behavior.
4. Run `pnpm run build:main`, `pnpm test -- <targeted files>`, and `openspec validate --all` before claiming completion.

Rollback: remove the new RTT log session type and open entry points; existing one-shot RTT debug tools remain unchanged and continue to provide fallback evidence.

## Open Questions

- Should duplicate open requests reuse an existing RTT log session or return a structured conflict? Initial preference: reuse when probe/channel/options match, reject when options differ.
- Should UI expose RTT open from the control profile panel, a dedicated debug panel, or MCP-only first? Initial implementation can be MCP/IPC-first with a minimal UI entry added after the session model is stable.
