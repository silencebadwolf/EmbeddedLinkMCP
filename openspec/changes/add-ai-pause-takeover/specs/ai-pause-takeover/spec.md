## ADDED Requirements

### Requirement: AI control state stores global and session pause latches with OR semantics
LinkTerm SHALL maintain a Main-owned AI control state with a versioned global pause latch,
per-session pause latches, epochs, changed timestamps, and changed-by metadata. Effective
pause for a session-scoped AI change SHALL be `global.paused || session.paused`; effective
pause for a global-scoped AI change SHALL be `global.paused`. Global Resume MUST clear only
the global latch. Session Resume MUST clear only the selected session latch. Take Over MUST
set the selected session latch and MUST NOT clear or bypass global pause.

#### Scenario: Session resume cannot bypass global pause
- **WHEN** global AI changes are paused
- **AND** a session latch is resumed
- **THEN** the session remains effectively paused
- **AND** no new session-scoped AI state-affecting operation is admitted

#### Scenario: Global resume cannot clear session pause
- **WHEN** a session is paused
- **AND** global pause is resumed
- **THEN** that session remains effectively paused
- **AND** other sessions follow their own latches and the global latch

#### Scenario: Take Over pauses only the selected session
- **WHEN** the user takes over session `S1`
- **THEN** LinkTerm sets the `S1` session pause latch
- **AND** does not modify the global latch
- **AND** does not pause unrelated session latches unless global pause is active

### Requirement: Pause state persists safely without becoming durable audit
LinkTerm SHALL persist AI pause latches and epochs in a versioned Electron `userData` record
so explicit Pause survives restart until explicit Resume. Missing or corrupt persisted data
MUST fall back to safe in-memory defaults with a bounded diagnostic. This persistence MUST
store only pause preference/state and MUST NOT implement or imply Phase 8 durable operation
audit, export, clear, retention, terminal transcript storage, or authorization authority.

#### Scenario: Paused state survives restart
- **WHEN** global pause or a session pause was saved successfully
- **AND** LinkTerm restarts
- **THEN** Main restores the corresponding latch and epoch
- **AND** AI changes for that scope remain paused until an explicit matching Resume

#### Scenario: Corrupt pause state is loaded
- **WHEN** the persisted AI control file is malformed, has an unsupported schema, or contains
  invalid latches
- **THEN** LinkTerm falls back to global not paused and no session latches
- **AND** emits a display-safe diagnostic
- **AND** does not expose raw file contents or stacks to Renderer

### Requirement: AI control IPC and preload expose only display-safe DTOs
LinkTerm SHALL expose AI control snapshots, events, pause/resume commands, and Take Over
commands through typed Main IPC and a narrow preload namespace. Renderer MUST receive only
display-safe DTOs. `PreparedOperation`, grants, authorization records, `CallerPrincipalId`,
`ExecutionAdmissionLease`, internal epochs/fingerprints/digests, compensation internals, raw
payloads, raw errors, and stacks MUST NOT cross preload.

#### Scenario: Renderer hydrates AI control state
- **WHEN** Renderer subscribes to AI control state
- **THEN** it registers the pushed-event listener before requesting the snapshot
- **AND** applies only current or newer revisions
- **AND** ignores stale revisions without mutating current pause state

#### Scenario: Malformed AI control event is received
- **WHEN** preload or a test fixture sends a malformed AI control event
- **THEN** Renderer records a bounded local diagnostic
- **AND** raw payload, stack, unknown fields, and internal authority objects are not retained

### Requirement: Operation admission linearizes pause, effect revalidation, approval consume, and lease acquisition
LinkTerm SHALL use a Main-owned `OperationAdmissionCoordinator` for AI state-affecting,
disruptive, and destructive-or-unknown operations. The coordinator SHALL perform effect
revalidation, effective pause checks, approval grant consumption when required, and
`ExecutionAdmissionLease` acquisition inside one serialized admission transaction. Pause and
lease acquisition races MUST linearize so either the pause commits first and blocks admission,
or the lease is acquired first and the operation is considered running/admitted.

#### Scenario: Pause wins the admission race
- **WHEN** a pause command commits before an AI operation acquires an execution lease
- **THEN** the operation is blocked or rejected with a stable pause-related result
- **AND** no effectful backend, session, manager, or job-start call is made

#### Scenario: Lease wins the admission race
- **WHEN** an AI operation acquires an execution lease before a pause command commits
- **THEN** the operation may continue its already admitted plan
- **AND** the UI indicates that running work may continue and stop controls are separate

#### Scenario: Double release is idempotent
- **WHEN** the same execution lease is released more than once
- **THEN** the second and later releases are no-ops
- **AND** no new operation is admitted by releasing an old lease

#### Scenario: Runtime restart invalidates leases
- **WHEN** Main runtime restarts
- **THEN** all previous execution leases are invalid
- **AND** any continuation must re-run approval, effect, expiry, and pause checks before a
  new lease can be acquired

### Requirement: Pause blocks AI changes but permits read-only AI checks and human/system paths
LinkTerm SHALL block new AI-origin state-affecting, disruptive, and destructive-or-unknown
operations while their scope is effectively paused. Read-only AI checks SHALL remain allowed.
Human-origin and system-origin operations SHALL remain allowed according to their existing
validation and risk policies.

#### Scenario: Read-only AI operation while paused
- **WHEN** AI changes are paused
- **AND** an AI read-only status or readiness check is invoked
- **THEN** LinkTerm allows the check through existing read-only paths
- **AND** Activity may record it without treating it as a new admitted change

#### Scenario: State-affecting AI operation while paused
- **WHEN** AI changes are paused
- **AND** an AI state-affecting operation attempts to execute
- **THEN** LinkTerm blocks it before the backend/session/manager boundary
- **AND** returns display-safe blocked-by-pause evidence

#### Scenario: Human operation while paused
- **WHEN** AI changes are paused
- **AND** the human performs an allowed operation
- **THEN** LinkTerm does not block that operation because of AI pause
- **AND** existing validation, approval, write queue, and backend rules still apply

### Requirement: Approved-but-paused operations do not execute until explicit resume and revalidation
LinkTerm SHALL treat human approval as decision-only and separate from AI admission. If an
operation is approved while its scope is effectively paused, it MUST remain blocked and MUST
NOT execute. After Resume, a continuation MUST revalidate principal, continuation kind,
surface, execution mode, effect fingerprint, target facts, expiry, and current pause epochs
before any lease or backend call is allowed.

#### Scenario: User approves while AI changes are paused
- **WHEN** an approval request is approved by a verified human action
- **AND** the operation scope is effectively paused
- **THEN** LinkTerm records approved-but-paused display state
- **AND** no effectful backend call is made

#### Scenario: Grant expires while paused
- **WHEN** an approved operation remains paused past its TTL
- **THEN** LinkTerm marks it expired/not executed
- **AND** resuming later does not execute it

#### Scenario: Resume and continuation revalidate the effect
- **WHEN** the user resumes the relevant pause latch
- **AND** the original consumer retries with an approval continuation
- **THEN** LinkTerm rechecks effect, principal, surface, mode, expiry, and pause epochs
- **AND** only a matching still-valid effect can acquire a new execution lease

### Requirement: AI-origin session writes honor pause without bypassing SessionManager or WriteQueue
LinkTerm SHALL treat AI-origin terminal writes as state-affecting session-scoped changes.
Such writes MUST pass effective pause admission before reaching the existing
`SessionManager`/session write/`WriteQueue` path. Human and system writes MUST continue
through the same existing path and MUST NOT be blocked by AI pause. Human high-priority input
MUST preserve the established high lane semantics.

#### Scenario: AI write is blocked before queueing
- **WHEN** a session is effectively paused
- **AND** an AI-origin write to that session is requested
- **THEN** LinkTerm rejects or blocks it before `WriteQueue.enqueue`
- **AND** the transport receives no write for that AI payload

#### Scenario: Human high-priority write remains available
- **WHEN** a session is effectively paused
- **AND** the human sends a high-priority interrupt or terminal input
- **THEN** the write uses the existing `WriteQueue` high lane
- **AND** paused AI writes cannot starve or reorder that human high-priority write

### Requirement: Session Take Over pauses new AI changes and returns focus to human control
LinkTerm SHALL provide a session-level Take Over action. Taking over a session SHALL set that
session's pause latch, focus the existing terminal input when available, show human-control
copy, and preserve the session, transcript, first-success state, Activity history, and already
executed AI results. Take Over MUST NOT inject terminal payload, close the session, create a
new session, reset hardware, or claim that running work has stopped.

#### Scenario: Take Over focuses an existing terminal
- **WHEN** the user activates Take Over for an open session
- **THEN** LinkTerm pauses new AI changes for that session
- **AND** focuses the terminal input for that session when it is mounted
- **AND** announces that human input remains available

#### Scenario: Take Over does not mutate terminal data
- **WHEN** Take Over is activated
- **THEN** LinkTerm does not write bytes to the transport
- **AND** does not append synthetic terminal transcript as if it came from the device

### Requirement: Running work exposes capability-aware stop controls without rollback promises
LinkTerm SHALL expose a display-safe cancellation capability for running jobs and operations:
`none`, `best-effort`, or `safe-point`. The UI SHALL show no stop action for `none`, `Request
stop (best effort)` for `best-effort`, and `Stop at safe point` for `safe-point`. Stop
requested, cancelled, failed after stop request, and succeeded after stop request MUST remain
distinct. UI copy MUST NOT promise rollback, undo, restored firmware, or guaranteed hardware
state.

#### Scenario: Safe-point job shows safe-point copy
- **WHEN** a running job declares `safe-point`
- **THEN** Activity Center shows `Stop at safe point`
- **AND** any follow-up status distinguishes stop requested from final cancellation

#### Scenario: Best-effort job shows best-effort copy
- **WHEN** a running job declares `best-effort`
- **THEN** Activity Center shows `Request stop (best effort)`
- **AND** explains that hardware may continue until the backend reports an outcome

#### Scenario: Non-stoppable job has no stop button
- **WHEN** a running job declares `none`
- **THEN** no stop button is shown for that job
- **AND** the UI may show a safe explanation that this operation cannot be safely stopped

### Requirement: Phase 7 UI is accessible, bilingual, bounded, and scoped to pause/takeover
LinkTerm SHALL provide English and Chinese copy for all new pause, resume, takeover, stop,
blocked, approved-paused, running-with-lease, diagnostic, disabled-reason, and no-rollback
labels. Pause and Take Over controls SHALL be keyboard reachable, screen-reader distinct,
non-color-only, reduced-motion-safe, and bounded for large activity/session lists. Phase 7
MUST NOT implement durable audit/export/clear, database storage, cloud services, default
telemetry, remote approval, generic chat UI, external installers, new hardware side-effect
paths, or hardware rollback promises.

#### Scenario: Paused status has independent priority
- **WHEN** AI changes are effectively paused and there are pending approvals or running jobs
- **THEN** the AI status capsule still exposes paused status
- **AND** pending, approved, running, or attention badges are shown as secondary information

#### Scenario: Keyboard user pauses and resumes
- **WHEN** the user navigates the Pause/Resume/Take Over controls by keyboard
- **THEN** each control is reachable and has a distinct accessible name
- **AND** focus returns to the invoking control or terminal target where appropriate

#### Scenario: Phase 7 scope is inspected
- **WHEN** the Phase 7 implementation is complete
- **THEN** no durable JSONL audit writer, export/clear implementation, database, cloud
  service, telemetry service, remote approval surface, generic chat UI, external installer,
  arbitrary script repair, or rollback guarantee is introduced by this change
- **AND** no real flash, erase, reset, J-Link, RTT, GDB server, serial payload write, or
  other hardware side-effect command is executed by Phase 7 validation
