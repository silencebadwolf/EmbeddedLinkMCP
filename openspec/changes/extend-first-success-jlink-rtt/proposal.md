## Why

Phases 3-5 give LinkTerm a safe Start Center, a serial first-success journey, and a
Main-owned Human Approval Broker. The next independently shippable slice is the
J-Link/RTT version of the same journey: users should be able to understand workspace,
probe, firmware, target, flash/verify, and RTT readiness; run a download-and-observe flow
through existing LinkTerm boundaries; and see specialized recovery guidance when J-Link or
RTT evidence is missing or silent.

Phase 6 must build on the Phase 5 approval model. New download, flash, or reflash entry
points cannot use a Renderer button click or `confirm=true` as authorization. They must
prepare an exact Main-owned effect, show display-safe consequences, and execute only after a
matching one-time grant is consumed.

## What Changes

- Extend Runtime Readiness with J-Link, firmware, and RTT-specific checks using read-only
  providers. These checks may inspect injected backend capabilities, probe availability,
  workspace/control-profile facts, target catalog facts, firmware metadata, and RTT config,
  but they must not connect, reset, flash, start GDB/RTT, mutate workspace/profile files, or
  open sessions.
- Add display-safe J-Link/RTT candidates and a versioned download-and-observe draft/plan that
  preserves evidence, confidence, workspace/profile provenance, firmware basename/hash/size
  metadata, target/interface/speed provenance, and RTT observation intent.
- Reuse existing control workflow job steps and Activity Center projections for
  connect/flash/verify/observe progress. Phase 6 may improve step labels and diagnostics,
  but it must not bypass `ControlWorkflowJobManager`, `runControlWorkflow`, `IJLinkBackend`,
  or the existing managers.
- Route every new guided Download, Flash, or Reflash CTA through the Phase 5
  `PreparedOperation` / Broker path. `approval:resolve` remains a decision-only channel, and
  approved execution requires an explicit continuation on the original execution surface.
- Add Main-only known-good `CompensationCandidate` tracking after verified success. Renderer
  receives only safe summaries. A candidate may offer a reflash recovery CTA only when source,
  hash, target binding, profile revision, and workflow mode still match; mismatch hides or
  invalidates the CTA and requires a new approval.
- Add specialized J-Link/RTT first-signal diagnostics for no backend, no probe, unsupported
  target, invalid firmware path/format, flash failure, verify failure, RTT connect failure,
  and RTT silent. RTT silent is not a serial failure and must not reuse serial copy.
- Generate profile suggestions after a verified download-and-observe success. Saving remains
  user-confirmed, uses existing profile/storage managers, and must not imply stable hardware
  identity beyond the recorded evidence.

## Scope Boundaries

This change implements Phase 6 only. It does not implement Pause/Take Over,
ExecutionAdmissionLease, durable JSONL audit/export/clear, remote approval, cloud services,
telemetry, databases, generic chat UI, external tool installers, arbitrary script repair, or
hardware rollback/checkpoint promises.

Phase 6 validation must use fake backends, fake managers, temporary files, spies, and
in-memory/mock transports only. No real J-Link probe, flash, erase, reset, GDB server, RTT
server, serial payload write, firmware deployment, or workspace-destructive action is
authorized by this change.

## Capabilities

### New Capabilities

- `jlink-rtt-first-success`: Defines the Phase 6 workspace/J-Link/firmware/RTT readiness
  model, download-and-observe draft/plan, approval-gated guided execution, specialized
  diagnostics, Main-only known-good compensation candidates, safe reflash summaries, profile
  suggestions, accessibility/i18n/performance requirements, and Phase 6 scope limits.

### Modified Capabilities

- Existing runtime-readiness/start-center, first-success UI, Activity Center, approval
  preparation/Broker, control workflow, control profile, J-Link backend abstraction,
  RTT log session, MCP runbook, preload/mock bridge, and i18n capabilities may be extended
  to support Phase 6. Existing `SessionManager`, `WriteQueue`, `Transport`,
  `IJLinkBackend`, `ControlWorkflowJobManager`, control-profile manager, workspace manager,
  and Main trust boundary remain authoritative and must not be bypassed.

## Impact

Expected new implementation areas:

- `src/core/readiness/` for J-Link/firmware/RTT read-only providers, candidate/draft helpers,
  target/firmware evidence normalization, and tests.
- `src/core/compensation/` or an equivalent Main-only core path for
  `CompensationCandidate`, candidate invalidation/matching, safe summary projection, and
  tests.
- `src/shared/*contract.ts` additions for display-safe J-Link/RTT readiness, draft, profile
  suggestion, and compensation summary DTOs only.
- `src/mcp/surfaces/control-workflow/` for plan-step diagnostics, approval preparation
  binding, job visibility, and no-side-effect tests around download-and-observe.
- `src/main/ipc/` and preload/mock additions only if a new Renderer-facing Phase 6
  snapshot/event/continuation bridge is needed.
- `src/renderer/features/readiness/`, `src/renderer/features/first-success/`,
  `src/renderer/features/activity/`, and `src/renderer/features/approval/` for Phase 6 UI
  projections, copy, focus, recovery actions, and bounded rendering.

Expected existing symbol seams that require fresh GitNexus upstream impact before
implementation if edited:

- Readiness: `RuntimeReadinessService`, `buildRuntimeReadinessSnapshot`,
  `resolveDeviceCandidates`, `DeviceCandidateSchema`, `ReadinessScopeSchema`,
  `ReadinessEvidenceSchema`, `StartCenter`, and readiness hydration/reducer hooks.
- First-success/UI: `FirstSuccessFlow`, `first-success-reducer`, `App`, `ConnectionDialog`,
  `ActivityCenterDrawer`, `AiStatusCapsule`, and i18n exports `en`/`zh`.
- Approval: `createMcpApprovalGate`, `prepareMcpControlWorkflowApprovalOperation`,
  `createControlProfileApprovalGate`, `ApprovalBroker.requestApproval`,
  `ApprovalBroker.consumeGrant`, and safe projection helpers if Phase 6 extends them.
- Workflow/J-Link/RTT: `runControlWorkflow`, `preflight`, `connectProbeStep`, `flashStep`,
  `verify` handling, `connectRttStep`, `observeRttStep`, `finalizeWorkflow`,
  `ControlWorkflowJobManager`, `registerControlWorkflowTools`, debug tool registrars,
  `registerRttLogSessionTools`, and `IJLinkBackend` types if changed.
- Main/preload/shared: `registerIpcHandlers`, `MainProcessContext`, `IPC_CHANNELS`,
  `PreloadAPI`, preload `api`, and `createMockPreloadAPI` if new Phase 6 IPC is introduced.

Renderer receives only display-safe readiness, plan, operation, approval, profile suggestion,
and compensation summary data. It must not receive `PreparedOperation`, `ApprovalGrant`,
`AuthorizationRecord`, `CallerPrincipalId`, internal fingerprints/digests, nonces, raw
source refs, firmware bytes, J-Link serial numbers, backend handles, raw SEGGER output,
raw errors/stacks, scripts, credentials, private paths beyond approved aliases/basenames, or
rollback-capable objects.

No new runtime dependency is expected. Any dependency for hashing, virtualized UI, process
inspection, storage, or parsing must be separately justified and pass license/dependency
review before use.
