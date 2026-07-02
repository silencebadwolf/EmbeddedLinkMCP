## Why

MCP clients can open managed RTT log sessions through `open_rtt_log_session`, but the App UI is the shared control surface. If an AI-created RTT log session is only visible to MCP reads and not reflected in the App session list/tab lifecycle, the human operator loses the single source of truth for live hardware state.

The current behavior is fragile around session lifecycle propagation: RTT log sessions are stored in the shared `SessionManager`, but App visibility depends on renderer hydration and main-process lifecycle events. State transitions emitted through the manager-level `session:state` event are not guaranteed to be forwarded as `session:stateChanged` lifecycle updates, so App windows can miss the transition that makes an MCP-created RTT log session understandable and visible.

## What Changes

- Treat App visibility as a required outcome for MCP-created RTT log sessions, not a best-effort side effect.
- Forward manager-level session state changes through the existing `SESSION_LIFECYCLE` IPC channel so renderer hydration sees state updates from AI/MCP operations.
- Add regression tests proving that a state-only manager event reaches App lifecycle listeners and that MCP-opened RTT log sessions remain visible through session summaries.
- Keep RTT log sessions read-only and keep one-shot RTT debug tools separate from continuous App-visible observation.

## Impact

- Affected code areas:
  - `src/main/ipc/session-ipc.ts`
  - RTT log session IPC/MCP tests
  - OpenSpec requirements for MCP/App session synchronization
- Behavior impact:
  - App windows receive `stateChanged` lifecycle events for shared session state transitions.
  - MCP-created RTT log sessions stay aligned with the App-visible session model.
  - No flash, reset, probe, or firmware behavior changes are included in this change.
