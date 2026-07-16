## Why

Phase 3 gives LinkTerm a safe Start Center and draft-backed path into existing serial
connection flows, but it deliberately stops before the actual first-success milestone. A new
user still needs LinkTerm to prove that the selected serial device produced non-empty device
text that was actually rendered in the terminal. Phase 4 completes the first A-side vertical
slice by separating session open, device data detection, terminal display availability, and
xterm completion-acknowledged visibility.

## What Changes

- Add a Main/core first-signal observation service that starts a main-minted `attemptId`,
  tracks revisioned `FirstSignalObservation` state, listens continuously from a baseline
  transcript cursor, and keeps listening after a silent timeout so late device output can
  still complete the journey.
- Add strict shared first-signal DTO schemas and typed IPC/preload APIs for start/status/stop
  and pushed observation events. Renderer must subscribe/listen before status hydration,
  ignore stale revisions, and treat malformed payloads as bounded safe diagnostics.
- Update renderer transcript rendering so non-empty `device` text only becomes visible after
  the corresponding xterm write completion callback or equivalent async acknowledgement
  succeeds while the terminal is still mounted. Synchronous `term.write` return, state/error
  events, partial UTF-8 chunks, delayed callbacks after dispose, and replay duplicates must
  not complete the journey.
- Add a renderer-local first-success coordinator/view model that drives the Start Center
  flow through plan review, connect, waiting, data received, display unavailable, silent,
  errored, disconnected, cancelled, and completed states.
- Add safe recovery actions: Keep waiting, Disconnect and edit, Back to session, Disconnect,
  Retry, Go to terminal, and optional save connection profile using existing profile schema
  only after signal-visible success.
- Preserve existing professional connection paths, `SessionManager`, `WriteQueue`,
  `Transport`, Activity Center, and Phase 3 readiness behavior.

## Scope Boundaries

This change implements Serial First Signal only. It does not implement Human Approval Broker,
`PreparedOperation`, approval grants/continuations, J-Link/RTT first signal, firmware
download/flash/verify, Pause/Take Over, durable JSONL audit/export/clear, cloud services,
telemetry, databases, generic chat UI, or hardware rollback/checkpoint promises.

Phase 4 may create/open a serial session only after an explicit user action in the guided
flow or existing connection dialog. It must not write serial payloads during connect, reset,
flash, start J-Link/RTT/GDB processes, install tooling, or infer stable device identity from
COM names or a saved profile.

## Capabilities

### New Capabilities

- `serial-first-signal`: Defines the Phase 4 serial first-success model, first-signal
  observation lifecycle, xterm completion-based visible acknowledgement, renderer
  first-success states, plan review, recovery actions, optional successful connection save,
  accessibility/i18n/performance requirements, and Phase 4 scope limits.

### Modified Capabilities

- Existing runtime-readiness/start-center, session IPC, transcript rendering, terminal view,
  connection dialog, app shell, activity status, preload API, and mock bridge capabilities
  may be adapted to start and observe the guided serial flow. Existing advanced connection,
  `SessionManager`, `WriteQueue`, `Transport`, MCP authorization, Activity Ledger/Center,
  and J-Link backend contracts remain authoritative.

## Impact

Expected new implementation areas:

- `src/core/session/first-signal-observation/` or equivalent for pure observation lifecycle,
  attempt state, revisioning, timers, replay/listener cleanup, and tests.
- `src/shared/first-signal-contract.ts` for strict display-safe DTO schemas.
- `src/main/ipc/first-signal-ipc.ts` for Main IPC registration and subscriber cleanup.
- `src/renderer/features/first-success/` for reducer, hydration/coordinator, hooks, and UI
  components.
- Tests under `tests/unit/core/session/first-signal-observation/`,
  `tests/unit/shared/`, `tests/unit/main/ipc/`, `tests/unit/main/preload-first-signal.test.ts`,
  `tests/unit/renderer/first-success/`, `tests/unit/renderer/hooks/`, and App/TerminalView
  component tests.

Expected existing symbol seams that require fresh GitNexus upstream impact before
implementation if edited:

- Main/session: `SessionManager`, `registerSessionIpc`, `onSessionEvent`,
  `onSessionDestroyed`, `registerIpcHandlers`, and `MainProcessContext`.
- Shared/preload: `IPC_CHANNELS`, `PreloadAPI`, `api`, and `createMockPreloadAPI`.
- Renderer transcript/terminal: `renderEventToXterm`, `XtermLike.write`, `useTranscript`,
  `TerminalView`, and session hydration/subscription hooks.
- Renderer flow/app shell: `App`, `StartCenter`, `ConnectionDialog`, app store/dialog
  prefill, Activity Center interactions, i18n exports `en`/`zh`.
- Optional profile save: existing connection/profile managers and IPC only if the successful
  connection save path is implemented in Phase 4.

Renderer receives only display-safe first-signal DTOs and renderer-local view state. It must
not receive raw transcript payload beyond the existing transcript rendering path, raw errors
or stacks, raw serial provider objects, workspace secrets, approval/lease/compensation
objects, J-Link handles, firmware bytes, scripts, or stable identity claims.

No new runtime dependency is expected. Any dependency for timers, UTF-8 decoding, virtualized
UI, or persistence beyond the current stack must be justified separately and pass license and
dependency review before implementation.
