# Implementation Plan: Phase 5 — add-human-approval

Date: 2026-07-14

Scope: Phase 5 Human Approval only. This plan implements the OpenSpec change
`add-human-approval`; it does not implement Phase 6 J-Link/RTT journey expansion, Phase 7
Pause/Take Over, or Phase 8 Durable Audit.

## Current facts

- Phase 0-4 changes are intentionally still dirty in one worktree. Do not reset, clean,
  commit, push, or create a PR.
- Phase 4 `add-serial-first-signal` is closed for its scope with fresh evidence; A+D overall
  is not complete.
- Current high-impact gates use legacy caller acknowledgement (`confirm=true`) in debug,
  runtime-control, control-workflow, and direct Control Profile download paths.
- Current Activity risk policy maps `read-only -> none`, `state-affecting -> notify`,
  `disruptive -> human-once`, `destructive-or-unknown -> human-once`; it records
  `clientAcknowledged` but no human grant authority.
- `registerControlProfileIpc` currently builds `flash-observe` workflow input with
  `confirm: true` and directly runs/schedules `runControlWorkflow`.
- `registerTool` is the central MCP wrapper; it begins OperationRecorder capture, checks
  schema/runtime freshness, invokes the business handler, and maps results to MCP payloads.
- `OperationLedger` is best-effort display/observation state and must not become approval
  authority.

## Guardrails

- `confirm=true`, a button click, or `approval:resolve` must not execute approval-required
  work in `interactive-required`.
- `PreparedOperation`, `ApprovalGrant`, `AuthorizationRecord`, `CallerPrincipalId`, nonces,
  source refs, prepared bytes/handles, raw rule ids, internal effect fingerprints, and target
  binding digests must remain Main-only.
- Renderer receives only explicit display-safe DTOs and can only resolve a visible pending
  request; it cannot prepare, mint, consume, or forge grants.
- MCP has no approval resolve tool.
- Wrong principal, continuation kind, consumer surface, or execution mode rejects without
  consuming or invalidating the correct grant.
- Prepare/deny/expire/quota/wrong-consumer/replay paths must have effectful backend call
  count 0.
- Existing `SessionManager`, `WriteQueue`, `Transport`, `IJLinkBackend`, control-profile
  managers, workflow runner, and JobManager remain the execution boundaries.

## Expected files

New:

- `src/core/approval/approval-mode-policy.ts`
- `src/core/approval/principal.ts`
- `src/core/approval/approval-contracts.ts` or `types.ts`
- `src/core/approval/effect-fingerprint.ts`
- `src/core/approval/prepared-operation.ts`
- `src/core/approval/approval-broker.ts`
- `src/core/approval/index.ts`
- `src/shared/approval-contract.ts`
- `src/main/ipc/approval-ipc.ts`
- `src/renderer/features/approval/approval-reducer.ts`
- `src/renderer/features/approval/useApproval.ts`
- `src/renderer/features/approval/ApprovalSheet.tsx`
- `tests/unit/core/approval/*`
- `tests/unit/shared/approval-contract.test.ts`
- `tests/unit/main/ipc/approval-ipc.test.ts`
- `tests/unit/main/preload-approval.test.ts`
- `tests/unit/renderer/approval/*`
- `tests/integration/human-approval-mcp.test.ts`
- `tests/integration/human-approval-control-profile.test.ts`
- `docs/engineering/phase-5-human-approval-evidence.md`

Likely edited:

- `src/shared/ipc-protocol.ts`
- `src/shared/preload-api.ts`
- `src/main/ipc/index.ts`
- `src/main/preload.ts`
- `tests/fixtures/mock-preload-api.ts`
- `src/mcp/registry.ts`
- `src/mcp/server.ts`
- `src/mcp/surfaces/debug/tools.ts`
- `src/mcp/surfaces/debug/tools-binary.ts`
- `src/mcp/surfaces/runtime-control/tools.ts`
- `src/mcp/surfaces/control-workflow/tools.ts`
- `src/main/ipc/control-profile-ipc.ts`
- `src/core/activity/risk-policy.ts`
- `src/core/activity/activity-event.ts`
- `src/core/activity/operation-recorder.ts`
- `src/shared/activity-contract.ts`
- `src/renderer/features/activity/*`
- `src/renderer/App.tsx`
- `src/renderer/i18n/en.ts`
- `src/renderer/i18n/zh.ts`

Every existing symbol above that is selected for editing requires fresh GitNexus upstream
impact before editing.

## Impact gates to run before product-code edits

Minimum expected upstream impacts:

- `registerTool`
- `invokeHandler`
- `createMcpServer`
- `registerControlProfileIpc`
- `buildRunDownloadWorkflowInput`
- `buildRunDownloadDeps`
- `registerControlWorkflowTools`
- `requiresHighImpactWorkflow`
- `registerDebugTools`
- `registerDebugBinaryTools`
- `registerRuntimeControlTools`
- `registerIpcHandlers`
- `MainProcessContext`
- `IPC_CHANNELS`
- `PreloadAPI`
- preload `api`
- `createMockPreloadAPI`
- `ActivityCommonShape`
- `resolveToolObservationPolicy`
- `OperationRecorder`
- `ActivityCenterDrawer`
- `AiStatusCapsule`
- `App`
- `en`
- `zh`

If any result is HIGH or CRITICAL, stop and report direct callers, affected processes, and
risk before editing that symbol.

## Slice 0 — entry characterization

Tests first:

- Focused regression tests proving current `confirm=true` semantics remain caller
  acknowledgement before migration:
  - MCP high-impact confirm-only reaches current behavior only in existing characterization.
  - direct Control Profile RUN/START currently hard-code confirm and run/start.
- Add a Phase 5 preflight test fixture that records these as to-be-migrated seams, not as
  desired final behavior.

Implementation:

- No product behavior change. Add or update only tests/docs if needed.

Validation:

- `pnpm exec vitest run tests/integration/high-impact-confirmation.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts`

## Slice 1 — display-safe contracts and internal core schemas

Tests first:

- `tests/unit/shared/approval-contract.test.ts`
  - strict unknown-field rejection;
  - caps for summary items, plan steps, artifacts, queue size, label lengths;
  - malformed pushed event becomes safe diagnostic;
  - internal-looking fields are rejected.
- `tests/unit/core/approval/approval-contracts.test.ts`
  - internal `PreparedOperation`, `ApprovalRequest`, `ApprovalGrant`,
    `AuthorizationRecord`, `PreparedContinuation`, and `ApprovalBrokerLimits`;
  - runtime/version fields;
  - internal fields are not imported from `src/shared`.

Implementation:

- Add `src/shared/approval-contract.ts` for `ApprovalCapabilitiesView`,
  `ApprovalRequestView`, `ApprovalSnapshotView`, `ApprovalEventView`, resolve request/result,
  safe error, `AuthorizationDisplay`, and constants.
- Add `src/core/approval/` internal types and schemas.
- Do not wire IPC or execution yet.

Validation:

- `pnpm exec vitest run tests/unit/shared/approval-contract.test.ts tests/unit/core/approval/approval-contracts.test.ts`

## Slice 2 — ApprovalModePolicy and principals

Tests first:

- `approval-mode-policy.test.ts`
  - desktop default `interactive-required`;
  - true headless `headless-deny`;
  - automation disabled;
  - args/header/window/renderer/transport inputs cannot change mode.
- `principal.test.ts`
  - shared runtime credential maps HTTP/stdio/reconnect to one local MCP principal;
  - desktop sender maps to a separate desktop principal;
  - self-declared principal/correlation/display/socket values are diagnostics only;
  - rate-limit key uses Main principal.

Implementation:

- Add `ApprovalModePolicy`.
- Add principal mapper with dependency-injected runtime id/credential id/sender id.
- Expose only display-safe capability labels.

Validation:

- `pnpm exec vitest run tests/unit/core/approval/approval-mode-policy.test.ts tests/unit/core/approval/principal.test.ts`

## Slice 3 — effect fingerprint and preparation

Tests first:

- `effect-fingerprint.test.ts`
  - stable canonical ordering;
  - `confirm`, `approvalId`, correlation/request/display hints excluded;
  - semantic args/defaults/profile revision/target binding/continuation/plan steps included;
  - artifact bytes hash/size included;
  - path realpath/symlink/content changes change fingerprint.
- `prepared-operation.test.ts`
  - read-only facade call allowlist;
  - effectful facade methods are zero in prepare;
  - artifact too large, total bytes too large, abort, malformed path/profile produce safe
    errors and release resources.

Implementation:

- Implement fingerprint helpers with Node `crypto` and stable JSON canonicalization.
- Implement side-effect-free preparers for initial surfaces:
  - MCP high-impact debug/runtime/control-workflow;
  - direct Control Profile RUN/START download.
- Start narrow with enough plan manifest metadata to render safe UI and prove TOCTOU guards.

Validation:

- `pnpm exec vitest run tests/unit/core/approval/effect-fingerprint.test.ts tests/unit/core/approval/prepared-operation.test.ts`

## Slice 4 — Broker authority

Tests first:

- `approval-broker.test.ts`
  - pending dedupe by mode/principal/continuation/effect;
  - queue ordering;
  - approve/deny/expire/supersede/consume;
  - wrong principal/kind/surface/mode preserves grant;
  - consumed replay no backend;
  - per-principal/global pending and rate limits;
  - approved-unconsumed grants are not evicted.
- `authorization-record.test.ts`
  - record schema;
  - serialized transaction;
  - schema/serialization/capacity/append failure fail closed;
  - subscriber/ledger failure does not grant or revoke.

Implementation:

- Implement `ApprovalBroker` as serialized Main-owned authority.
- Add injectable clock/id generator/limits/record sink.
- Return display-safe projection events, but keep internal state private.

Validation:

- `pnpm exec vitest run tests/unit/core/approval/approval-broker.test.ts tests/unit/core/approval/authorization-record.test.ts`

## Slice 5 — IPC/preload/mock bridge

Tests first:

- `approval-ipc.test.ts`
  - capabilities/snapshot/subscribe/unsubscribe/resolve/event;
  - listener-before-snapshot;
  - destroyed-window cleanup and send race;
  - malformed request/payload;
  - stale revision rejection;
  - sender validation;
  - DTO-only output.
- `preload-approval.test.ts`
  - narrow namespace;
  - runtime parsing of invoke responses/events;
  - invalid-payload safe diagnostics;
  - listener removal;
  - no exposed `ipcRenderer`.
- mock fixture tests for deterministic event/revision helpers.

Implementation:

- Add `approval-ipc.ts`.
- Extend `IPC_CHANNELS`, `PreloadAPI`, `main/preload.ts`, `MainProcessContext`,
  `registerIpcHandlers`, and mock preload fixture.
- Do not wire execution migration yet.

Validation:

- `pnpm exec vitest run tests/unit/main/ipc/approval-ipc.test.ts tests/unit/main/preload-approval.test.ts tests/unit/fixtures/mock-preload-api.test.ts tests/unit/main/ipc/index.test.ts`

## Slice 6 — Renderer Approval Sheet and Activity labels

Tests first:

- Reducer/hook tests:
  - snapshot/event ordering;
  - pending/approved-ready/denied/expired/superseded/consumed;
  - queue one active sheet;
  - stale/malformed diagnostics.
- Component tests:
  - exact safe action/risk/target/argument/plan/artifact display;
  - approve once and deny call only approval resolve;
  - no rollback wording;
  - focus return and non-stealing assertive notification;
  - keyboard/small window/reduced motion.
- Activity tests:
  - approval not required;
  - client acknowledgement required;
  - client acknowledged but not authorized;
  - approved once by you;
  - future automation label distinct.

Implementation:

- Add `src/renderer/features/approval/`.
- Wire `App` with Approval Sheet and activity capsule/drawer state.
- Add EN/ZH copy.
- Ensure `approval:resolve` only resolves; continuation remains explicit.

Validation:

- `pnpm exec vitest run tests/unit/renderer/approval tests/unit/renderer/activity tests/unit/renderer/App.test.tsx tests/unit/renderer/readiness/readiness-i18n.test.ts`

## Slice 7 — MCP migration

Tests first:

- `tests/integration/human-approval-mcp.test.ts`
  - high-impact debug/runtime/control-workflow confirm-only returns approval-required and
    backend=0;
  - missing legacy acknowledgement remains confirmation-required where applicable;
  - valid approval continuation executes once;
  - replay no reexecute;
  - wrong principal/kind/surface/mode backend=0 and preserves grant;
  - semantic effect change supersedes;
  - legacy client fails closed with guidance.

Implementation:

- Extend `registerTool`/server options with approval authority dependencies.
- For `human-once` policy:
  - if current acknowledgement missing, keep existing confirmation-required behavior;
  - if acknowledged but no approval continuation, prepare/request and return approval-required;
  - if continuation present, verify/consume before invoking handler.
- Ensure runtime freshness and schema semantics remain compatible.
- Update high-impact descriptions/runbook after behavior changes.

Validation:

- `pnpm exec vitest run tests/integration/high-impact-confirmation.test.ts tests/integration/human-approval-mcp.test.ts tests/unit/mcp/registry.test.ts tests/unit/mcp/tool-descriptions.test.ts tests/unit/mcp/agent-runbook.test.ts`

## Slice 8 — Control Profile direct RUN/START migration

Tests first:

- `tests/integration/human-approval-control-profile.test.ts` and focused IPC tests:
  - initial RUN/START click/hard-coded confirm prepares only, backend/job=0;
  - approve does not execute;
  - explicit `continue-approved` RUN executes sync once;
  - explicit `continue-approved` START creates background job once;
  - approve → Renderer reload → Continue;
  - duplicate continuation no reexecute;
  - wrong surface/mode/principal preserves grant;
  - MCP/IPC cross-consume backend=0;
  - artifact/profile/default/target changes require new approval.

Implementation:

- Extend direct payload schema with a continuation union:
  - `{ kind?: 'prepare' }` default initial request;
  - `{ kind: 'continue-approved'; approvalId: string }`.
- Use the same broker and preparer as MCP but bind surface=`control-profile` and
  executionMode=`sync` or `background`.
- Keep existing `runControlWorkflow`, `ControlWorkflowJobManager`, manager, and backend
  boundaries.

Validation:

- `pnpm exec vitest run tests/unit/main/ipc/control-profile-ipc.test.ts tests/integration/human-approval-control-profile.test.ts tests/unit/main/preload-approval.test.ts`

## Slice 9 — closeout evidence and reviews

Focused validation:

```powershell
pnpm exec vitest run tests/unit/shared/approval-contract.test.ts tests/unit/core/approval tests/unit/main/ipc/approval-ipc.test.ts tests/unit/main/preload-approval.test.ts tests/unit/renderer/approval tests/integration/human-approval-mcp.test.ts tests/integration/human-approval-control-profile.test.ts
```

Full validation:

```powershell
pnpm run lint
pnpm run build
pnpm run test
pnpm run test:coverage
pnpm run validate:licenses
pnpm audit --prod
pnpm exec openspec validate add-human-approval --strict
git diff --check -- openspec/changes/add-human-approval docs/superpowers/plans/2026-07-14-add-human-approval.md src tests
node .gitnexus/run.cjs analyze --pdg
```

GitNexus closeout:

- Directed taint/PDG:
  - `src/core/approval/*`
  - `src/main/ipc/approval-ipc.ts`
  - `src/main/preload.ts`
  - `src/mcp/registry.ts`
  - `src/main/ipc/control-profile-ipc.ts`
  - `src/mcp/surfaces/control-workflow/tools.ts`
  - high-impact debug/runtime tool files
  - `src/renderer/features/approval/*`
- `detect_changes({ scope: "compare", base_ref: "main" })`
- Record CRITICAL cumulative dirty-worktree warning honestly if Phase 0-5 remain uncommitted.

Evidence doc:

- `docs/engineering/phase-5-human-approval-evidence.md`
- Must record:
  - confirm-only backend=0;
  - prepare read-only/effectful=0;
  - one-time grant and replay backend=0;
  - wrong consumer preserves grant;
  - direct RUN/START two-invocation continuation;
  - Main-only object boundary;
  - a11y/i18n/performance;
  - no real hardware side effects;
  - review findings and dispositions.

## Done criteria for Phase 5

- `confirm=true` alone cannot execute `human-once` operations in interactive mode.
- Direct Control Profile RUN/START download cannot execute from button click or
  hard-coded confirm alone.
- Valid human approval grant is Main-owned, display-reviewed, bound, short-lived, and consumed
  once.
- Wrong principal/kind/surface/mode, deny, expiry, quota, replay, and semantic change produce
  effectful backend call count 0 with explicit terminal state.
- Renderer/preload never receive internal approval authority objects.
- OpenSpec tasks are checked only after fresh verification and evidence are recorded.
- Phase 5 is not described as A+D completion, and Phase 6 requires explicit user
  authorization.
