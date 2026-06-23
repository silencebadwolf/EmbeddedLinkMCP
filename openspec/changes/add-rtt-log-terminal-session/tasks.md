## 1. Core RTT Log Session

- [x] 1.1 Add failing unit tests for an RTT log session that opens, polls backend bytes, appends device transcript events, ignores empty reads, and closes without further polling.
- [x] 1.2 Add failing unit tests for polling errors transitioning the session to `errored` with a bounded transcript error event.
- [x] 1.3 Implement the minimal RTT log session module over `IJLinkBackend.rttRead` without Electron imports.
- [x] 1.4 Add duplicate probe/channel handling in the session manager or RTT session factory path.

## 2. Shared Contracts and Session Metadata

- [x] 2.1 Extend shared session metadata/types to represent RTT log sessions explicitly without changing serial/SSH/local-shell config behavior.
- [x] 2.2 Update session summaries, renderer store typing, tab icons/labels, and hydration tests for RTT log sessions.
- [x] 2.3 Ensure generic writes to RTT log sessions return a structured non-writable-session error and do not call backend write paths.

## 3. Main Process and MCP Entry Points

- [x] 3.1 Add failing IPC tests for opening an RTT log session from a connected probe/channel and receiving lifecycle/session list visibility.
- [x] 3.2 Implement main-process RTT log session open/close entry points using the shared `SessionManager` and injected `IJLinkBackend`.
- [x] 3.3 Add MCP tool tests for opening/reusing/rejecting RTT log sessions and preserving `origin`, `schemaVersion`, and structured errors.
- [x] 3.4 Register the MCP RTT log session tool through the LinkTerm registry with sensitivity and schema-version behavior.

## 4. Renderer Integration

- [x] 4.1 Add renderer tests proving RTT log sessions render in the tab bar and use the existing transcript/xterm path.
- [x] 4.2 Gate `TerminalView` writes for `connectionType='rtt-log'` so typing does not send bytes.
- [x] 4.3 Add a minimal UI entry point or status affordance for opening/viewing RTT logs without saving them as connection profiles.

## 5. Agent Guidance and Documentation

- [x] 5.1 Update runbook/status guidance to distinguish continuous RTT log terminal sessions from one-shot `rtt_read/search/clear` debug tools.
- [x] 5.2 Update relevant project plan notes if the implementation completes or if scope changes during coding.

## 6. Verification

- [x] 6.1 Run targeted RTT core/session tests.
- [x] 6.2 Run targeted MCP/debug/runbook tests affected by the new tool.
- [x] 6.3 Run targeted renderer tests for tabs/TerminalView behavior.
- [x] 6.4 Run `openspec validate add-rtt-log-terminal-session --strict` and `openspec validate --all`.
- [x] 6.5 Run `pnpm run build:main` and a broader build/test command if the touched surface requires it.
