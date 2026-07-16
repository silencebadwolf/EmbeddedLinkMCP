# Design: Phase 7 Pause / Stop / Take Over

## Goals

- Let the human operator pause new AI changes globally or for a single session.
- Guarantee OR semantics: effective pause is `global.paused || session.paused`.
- Linearize pause/resume and AI admission with epoch fences so no new AI change is admitted
  after the pause commit.
- Keep read-only AI checks, human/system operations, and human high-priority terminal input
  available while AI changes are paused.
- Show honest controls for running work based on declared cancellation capability rather
  than treating `AbortSignal` as a rollback guarantee.
- Let the user take over a session by pausing that session's new AI changes and focusing the
  terminal without closing or rewriting the session.

## Non-goals

- Durable audit/export/clear/retention, Phase 8 performance/audit productization, or JSONL
  persistence.
- Cloud accounts, remote approval, telemetry, databases, generic chat UI, or external
  installer flows.
- New flash/erase/reset/GDB/RTT/serial side-effect capability.
- Hardware rollback, checkpoint, undo, or "guaranteed stop" promises.
- Replacing `SessionManager`, `WriteQueue`, `Transport`, `IJLinkBackend`,
  `ControlWorkflowJobManager`, approval broker, or manager boundaries.

## Ownership model

```text
Human UI / Main IPC
  -> AiControlService
     -> global/session pause latches + epochs + display-safe snapshot
     -> persisted userData pause state

AI state-affecting operation / AI session write
  -> existing risk/approval/precondition checks
  -> OperationAdmissionCoordinator serialized transaction
     -> effect revalidation
     -> pause epoch check
     -> approval grant consume when required
     -> Main-only ExecutionAdmissionLease
  -> existing SessionManager / manager / IJLinkBackend / JobManager path
```

Renderer owns only display and user intent. Main owns pause state, epochs, admission leases,
lease invalidation, and persistence. Activity and approval views are projections only.

## AI control state

Core state:

```ts
interface AiControlState {
  schemaVersion: '1.0.0';
  global: {
    paused: boolean;
    epoch: number;
    changedAt: string;
    changedBy: 'human' | 'system';
  };
  sessions: Record<string, {
    paused: boolean;
    epoch: number;
    changedAt: string;
    changedBy: 'human' | 'system';
  }>;
}
```

Each pause/resume that changes a latch increments that latch's epoch and records a new
`changedAt`. Repeating the same command is idempotent and does not create a fake epoch
advance unless the persisted state was corrupt and Main performs a safe repair transition.

Persistence is a versioned JSON file under Electron `userData`. Missing or corrupt data
falls back to a safe default: global not paused, no session latches, epochs starting at 0, and
a display-safe diagnostic. Persistence failure must not silently claim a pause was saved; the
command result surfaces a safe warning and the in-memory latch remains authoritative for the
current runtime.

## Effective pause semantics

For global-scoped operations:

```text
effectivePaused = global.paused
```

For session-scoped operations:

```text
effectivePaused = global.paused || session.paused
```

Global Resume only clears `global.paused`. Session Resume only clears the selected session
latch. Take Over sets the selected session latch to paused and does not modify global state.
No local resume may admit AI work while another active latch still pauses that scope.

Read-only AI operations remain allowed while paused, but they must stay visible in Activity
without pulsing the main status. Human/system operations and human terminal writes remain
allowed. State-affecting, disruptive, destructive-or-unknown AI operations and AI-origin
terminal writes are blocked before admission.

## OperationAdmissionCoordinator and leases

The coordinator runs admission under a single Main-owned serialized transaction. For an
operation that requires approval, the final backend boundary order is:

1. resolve the server-owned request/operation identity;
2. verify Main-assigned principal, continuation kind, surface, and execution mode;
3. revalidate the prepared effect/new intent;
4. check effective pause and expected epochs;
5. consume approval grant when required;
6. acquire `ExecutionAdmissionLease`;
7. call the existing backend/session/manager path.

If pause wins the race before lease acquisition, the operation is blocked or rejected with a
stable display-safe pause code and effectful backend call count 0. If the operation already
holds a lease, pause does not retroactively cancel or falsify its state.

Lease shape:

```ts
interface ExecutionAdmissionLease {
  schemaVersion: '1.0.0';
  leaseId: string;
  runtimeId: string;
  operationId: string;
  principalId: CallerPrincipalId;
  scope: { kind: 'global' } | { kind: 'session'; sessionId: string };
  globalEpoch: number;
  sessionEpoch?: number;
  planManifestDigest?: string;
  acquiredAt: string;
}
```

`ExecutionAdmissionLease` remains Main-only and must never cross preload. The display
projection may say that an operation is running with an admitted lease, but it cannot expose
`leaseId`, `principalId`, epochs, manifest digest, internal fingerprints, or authorization
objects. Double release is idempotent. Runtime restart invalidates all leases.

## Approval integration

Approved-but-not-admitted operations can be blocked by pause. Approval resolution itself is
still decision-only and must not execute. On resume, continuation must re-run the same
principal/kind/surface/mode/effect/expiry checks plus the pause fence before a lease can be
acquired. If the grant expires while paused, the operation becomes expired/not executed.

Wrong consumer behavior remains Phase 5 behavior: principal/kind/surface/mode mismatch
rejects with effectful backend call count 0 and does not destroy the correct consumer's grant.
Pause must not be implemented by weakening approval binding or by moving authority into the
Renderer.

## Session writes and Take Over

AI-origin session writes are state-affecting. They must pass admission before reaching the
existing `SessionManager`/`WriteQueue` path. Human and system writes bypass AI pause policy
but still use existing validation, ordering, and error handling. Human high-priority writes
continue to use the established `priority: 'high'` lane and must not be starved by paused or
blocked AI normal writes.

Take Over for a session:

- sets that session pause latch;
- focuses the existing terminal input for the session;
- announces that new AI changes for the session are paused and human high-priority input is
  available;
- leaves global pause unchanged;
- leaves existing transcript, session state, first-success evidence, and already executed AI
  activity visible.

Take Over does not close a session, create a new session, inject terminal payload, write a
serial payload, reset hardware, or imply that running work has stopped.

## Capability-aware stop

Running jobs and backend-backed operations expose a display-safe cancellation capability:

```ts
type CancellationCapability = 'none' | 'best-effort' | 'safe-point';
```

- `none`: no stop button is shown.
- `best-effort`: UI shows `Request stop (best effort)`.
- `safe-point`: UI shows `Stop at safe point`.

`AbortSignal` is only a mechanism. A job may use it internally, but the user-facing capability
comes from the backend/job contract. Stop request and final stop outcome are distinct:
`stop-requested`, `cancelled`, `failed-after-stop-request`, `succeeded-after-stop-request`,
and "stopping at next safe point" must not be collapsed into a rollback claim.

The stop path must use existing job manager/backend cancellation seams. It must not call new
shell commands, direct SEGGER tools, flash/erase/reset helpers, or unowned task terminals.

## IPC, preload, and renderer

Phase 7 adds a narrow display-safe AI control namespace:

```text
aiControl:snapshot
aiControl:subscribe
aiControl:pauseGlobal
aiControl:resumeGlobal
aiControl:pauseSession
aiControl:resumeSession
aiControl:takeOverSession
aiControl:event
```

Preload exposes only safe DTOs and validated commands. Renderer must attach event listeners
before hydration, ignore stale revisions, and treat malformed payloads as bounded local
diagnostics without retaining raw payloads/stacks. Main validates sender identity for commands.

Renderer surfaces:

- Header/AI status capsule menu: `Pause AI changes` / `Resume AI changes`.
- Activity Center cards for blocked-by-pause, approved-but-paused, running-with-lease, and
  stop-requested states.
- Approval Sheet state: `Approved · paused` and `Approved · ready to continue` remain
  distinct.
- Session controls: `Take over` for the active session and session pause/resume indicators.
- Capability-aware stop button text based on `CancellationCapability`.

Pause status has independent priority: while effective pause is true, the capsule shows
paused state plus parallel badges for approval/running/attention as needed. Low-value
read-only bursts must not make the capsule flicker.

## Accessibility, i18n, and bounded rendering

All new labels, statuses, disabled reasons, safe diagnostics, stop text, takeover copy, and
resume explanations must exist in English and Chinese. Controls must be keyboard reachable,
have distinct accessible names, avoid color-only communication, return focus after dialogs or
menus where possible, and respect reduced-motion settings. Lists of paused/blocked operations
and diagnostics must be bounded so terminal-adjacent rendering remains responsive.

## Risks and mitigations

- **Pause/approval race**: one serialized admission transaction orders pause epoch checks,
  effect revalidation, grant consume, and lease acquisition.
- **False stop promise**: UI text derives from declared capability and distinguishes request
  from final cancellation.
- **Human input blocked by AI pause**: origin and priority checks keep human/system writes
  available through existing `WriteQueue`.
- **Renderer authority leak**: Renderer receives only safe snapshots and command results;
  leases, principals, authorization records, grants, and prepared operations stay Main-only.
- **Persistence surprise**: pause latches survive restart; explicit resume is required.
- **Scope creep into audit**: Phase 7 stores only pause preference/state in userData and does
  not implement durable operation audit/export/clear.

## Migration plan

1. Add OpenSpec requirements and a precise implementation plan for Phase 7 only.
2. Add pure AI control state, persistence, effective pause, and admission lease tests.
3. Implement `AiControlService` and `OperationAdmissionCoordinator` without execution
   integration.
4. Integrate approved continuation and MCP/direct state-affecting operation admission.
5. Integrate AI-origin session write admission and Take Over while preserving human high lane.
6. Add cancellation capability to job/activity projections and capability-aware stop UI.
7. Add Main IPC/preload/mock bridge plus Renderer controls, Activity Center, Approval Sheet,
   and i18n.
8. Run focused tests after every slice, then full quality, review, GitNexus, PDG/taint, and
   Phase 7 evidence closeout.
