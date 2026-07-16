> **状态说明（2026-07-15）**：本 change 是历史实现记录。产品负责人随后选择
> `observe-only-ai-execution`，运行时审批链已删除；不得依据本 change 重新添加批准入口。

## Why

Phases 1-4 make AI operations visible and complete the serial first-success journey, but
high-impact LinkTerm operations are still protected only by legacy caller acknowledgement
such as `confirm=true`. That acknowledgement can be supplied by an MCP client or hard-coded
Renderer path and is not proof that a human reviewed the exact effect. Phase 5 upgrades
approval-required actions to a Main-owned, one-time human approval model before Phase 6 adds
new J-Link/RTT download-and-observe experiences.

## What Changes

- Add a Main/core Human Approval Broker with strict internal `PreparedOperation`,
  `ApprovalRequest`, `ApprovalGrant`, `AuthorizationRecord`, and `CallerPrincipalId`
  contracts. These objects remain Main-only; Renderer receives explicit display-safe
  projections.
- Freeze `ApprovalMode` at Main startup. Desktop defaults to `interactive-required`;
  true headless defaults to `headless-deny`; `automation-allowlisted` is not enabled in this
  first version and cannot be selected by request args, headers, Renderer state, window
  visibility, transport, reconnect, or legacy client shape.
- Add preparation for approval-required operations that canonicalizes semantic arguments,
  expanded defaults, target binding, continuation kind/surface/execution mode, artifact
  metadata, and plan steps into a stable effect fingerprint. Prepare may use only explicit
  read-only facades and must call zero effectful backend methods.
- Add pending request dedupe/queue, per-principal and global limits, artifact/bytes limits,
  TTL expiry, deny, supersede, and one-time consume semantics. `AuthorizationRecord` is the
  mandatory authorization authority; best-effort Activity Ledger data cannot grant or revoke
  approval.
- Add approval IPC/preload APIs and a Renderer Approval Sheet that can approve or deny exactly
  the display-safe request shown to the user. `approval:resolve` records a decision only; it
  must not execute a prepared operation.
- Migrate the current approval-required execution seams so `confirm=true` becomes only the
  legacy first-layer client acknowledgement:
  - MCP registry high-impact debug/runtime/control-workflow tools;
  - `run_control_workflow` high-impact modes and background jobs;
  - `registerControlProfileIpc` direct `CONTROL_PROFILE_RUN_DOWNLOAD` and
    `CONTROL_PROFILE_START_DOWNLOAD`, using two-invocation continuation with the same
    original channel and an `approvalId`.
- Extend Activity/Activity Center projections so caller acknowledgement, human approval, and
  future automation authorization are distinguishable without leaking internal authority
  fields.

## Scope Boundaries

This change implements Human Approval only. It does not implement J-Link/RTT first-signal
journeys, new download-and-observe CTAs, Pause/Take Over, ExecutionAdmissionLease enforcement,
durable JSONL audit/export/clear, remote approval, cloud services, telemetry, databases,
generic chat UI, compensation/reflash UI, or hardware rollback/checkpoint promises.

Phase 5 must not add new hardware side-effect capabilities. Existing effectful operations may
execute only after the legacy acknowledgement gate plus a valid one-time approval grant when
their policy requires `human-once`.

## Capabilities

### New Capabilities

- `human-approval`: Defines immutable approval mode, stable local principals, Main-only
  prepared operations and grants, effect fingerprinting, display-safe approval request views,
  approval IPC/preload, Approval Sheet UI, one-time grant consumption, limits, expiry,
  denial, supersede, and fault-closed authorization records.

### Modified Capabilities

- Existing activity/risk policy, MCP registry, high-impact debug/runtime/control-workflow
  tools, control-profile direct download IPC, Activity Center, preload API, and mock bridge
  may be adapted to request and consume human approval. Existing `SessionManager`,
  `WriteQueue`, `Transport`, `IJLinkBackend`, managers, first-signal monitor, Start Center,
  and advanced connection contracts remain authoritative and must not be bypassed.

## Impact

Expected new implementation areas:

- `src/core/approval/` for internal schemas, mode policy, principal mapping, preparation,
  fingerprinting, broker state machine, authorization records, limits, and tests.
- `src/shared/approval-contract.ts` for display-safe approval DTOs only.
- `src/main/ipc/approval-ipc.ts` and Main composition wiring.
- `src/renderer/features/approval/` for Approval Sheet reducer, hydration, and UI.
- Tests under `tests/unit/core/approval/`, `tests/unit/shared/`,
  `tests/unit/main/ipc/`, `tests/unit/main/preload-approval.test.ts`,
  `tests/unit/renderer/approval/`, and focused integration tests for MCP/control-profile
  migration.

Expected existing symbol seams that require fresh GitNexus upstream impact before
implementation if edited:

- Approval-critical runtime seams: `registerTool`, `invokeHandler`, `createMcpServer`,
  `registerControlProfileIpc`, `registerControlWorkflowTools`, `ControlWorkflowJobManager`,
  `registerRuntimeControlTools`, and high-impact debug tool registrars.
- Main/preload/shared: `registerIpcHandlers`, `MainProcessContext`, `IPC_CHANNELS`,
  `PreloadAPI`, preload `api`, and `createMockPreloadAPI`.
- Activity projections: `ActivityCommonShape`, `OperationRecorder`, `OperationLedger`,
  `ActivityCenterDrawer`, `AiStatusCapsule`, and i18n exports `en`/`zh` if changed.
- Renderer shell: `App`, Activity Center integration, and Approval Sheet focus/queue
  surfaces.

Renderer receives only `ApprovalCapabilitiesView`, `ApprovalRequestView`,
`ApprovalDecisionRecord`-like display projections, and safe authorization labels. It must not
receive `PreparedOperation`, `ApprovalGrant`, `AuthorizationRecord`, `CallerPrincipalId`,
nonces, prepared artifact bytes/handles, internal effect/target-binding digests, source refs,
raw automation rule ids/config paths, credentials, scripts, firmware bytes, raw errors/stacks,
or J-Link/backend handles.

No new runtime dependency is expected. Any dependency for hashing, queues, modals, or
storage must be separately justified and pass license/dependency review before use.
