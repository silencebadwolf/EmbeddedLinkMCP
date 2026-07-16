> **状态说明（2026-07-15）**：本 change 是历史实现记录。产品负责人明确不需要暂停 AI、
> 接管或恢复机制；当前运行时以 `observe-only-ai-execution` 为准。

## Why

Phases 1-6 make AI actions visible, require real human approval for high-impact effects,
and deliver serial plus J-Link/RTT first-success journeys. Users still need an immediate,
honest way to pause new AI changes, keep human terminal control, request only capability-
appropriate stops for running work, and take over an active session without pretending that
already-started hardware effects can be rolled back.

Phase 7 adds the admission and UI controls that convert visibility/approval into practical
operator control. The key safety property is not "nothing can happen after pause"; it is
"after the pause commit, no new AI state-affecting change is admitted without an explicit
resume and revalidation." Running operations with a valid execution lease may continue to
their declared safe points, and the UI must say that plainly.

## What Changes

- Add a Main/core AI control model with versioned global and session pause latches, epochs,
  and restart-safe persistence in Electron `userData`.
- Add an `OperationAdmissionCoordinator` and Main-only `ExecutionAdmissionLease` contract
  that linearizes pause/resume, effect revalidation, approval consume, and lease acquisition.
- Enforce global/session pause OR semantics for AI state-affecting operations and AI session
  writes. Global Resume clears only the global latch; Session Resume clears only that
  session latch; neither can bypass the other.
- Preserve read-only AI checks plus human/system paths while paused. Human high-priority
  terminal input continues through the existing `SessionManager`/`WriteQueue` path.
- Add session Take Over: pause new AI changes for that session, focus the terminal, and show
  a human-control hint without closing the session or hiding already executed AI results.
- Add capability-aware stop presentation for running work. Backends/jobs declare
  `none | best-effort | safe-point`; Activity Center and operation controls show only the
  matching action text and never promise rollback.
- Extend approval/activity/UI projections so approved-but-paused, blocked-by-pause,
  running-with-lease, stop-requested, and takeover states are visible using display-safe DTOs.

## Scope Boundaries

This change implements Phase 7 only. It does not implement durable JSONL audit, export,
clear, retention enforcement, cloud services, telemetry, databases, remote approval,
generic chat UI, new hardware rollback/checkpoint promises, new external installers, or
new hardware side-effect capability.

Phase 7 must not bypass existing `SessionManager`, `WriteQueue`, `Transport`,
`IJLinkBackend`, `ControlWorkflowJobManager`, managers, or the Main trust boundary. Internal
`PreparedOperation`, `Grant`, `AuthorizationRecord`, `CallerPrincipalId`,
`ExecutionAdmissionLease`, and compensation objects remain Main-only. Renderer receives only
display-safe pause/activity/approval/job views.

## Capabilities

### New Capabilities

- `ai-pause-takeover`: Defines global/session AI pause state, pause persistence, effective
  pause OR semantics, Main-only admission leases, blocked-by-pause operation states,
  session Take Over, human high-lane preservation, and capability-aware stop UI.

### Modified Capabilities

- Human approval consume paths, direct Control Profile continuation, MCP high-impact tools,
  session write paths, control workflow jobs, Activity Center, AI status capsule,
  Approval Sheet, preload API, and i18n may be adapted to honor and display pause/takeover
  state. Existing first-success, readiness, J-Link/RTT, approval, activity, session, write
  queue, and backend abstractions remain authoritative.

## Impact

Expected new implementation areas:

- `src/core/ai-control/` for pause state, persistence adapter, admission coordinator, lease
  lifecycle, and tests.
- `src/shared/ai-control-contract.ts` for display-safe pause/takeover DTOs.
- Main IPC/preload wiring for pause state snapshots, pause/resume commands, and takeover
  actions.
- Renderer controls in the existing Activity Center/status/session surfaces for Pause,
  Resume, Take Over, approved-but-paused, and capability-aware Stop.

Expected existing symbol seams that require fresh GitNexus upstream impact before
implementation if edited:

- Approval and execution seams: `createMcpApprovalGate`, `ApprovalBroker`,
  `registerControlProfileIpc`, `registerControlWorkflowTools`, `registerRuntimeControlTools`,
  high-impact debug tool registrars, and control workflow continuation helpers.
- Session and terminal seams: `SessionManager`, `SessionBase.write`, `WriteQueue.enqueue`,
  terminal/preload session IPC handlers, and terminal renderer controls.
- Job and backend seams: `ControlWorkflowJobManager`, `runControlWorkflow`,
  `ControlWorkflowJob`, workflow status projections, and J-Link/RTT backend wrappers.
- Main/preload/shared: `registerIpcHandlers`, `MainProcessContext`, `IPC_CHANNELS`,
  `PreloadAPI`, preload `api`, and `createMockPreloadAPI`.
- Activity/renderer/i18n: `OperationRecorder`, `OperationLedger`, Activity Center, AI status
  capsule, Approval Sheet, session tab/origin controls, `App`, and `en`/`zh`.

No new runtime dependency is expected. Any dependency for storage, locking, focus handling,
or scheduling must be separately justified and pass license/dependency review before use.
