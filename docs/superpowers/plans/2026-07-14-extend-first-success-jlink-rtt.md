# Phase 6 implementation plan — extend-first-success-jlink-rtt

Date: 2026-07-14

Scope: Phase 6 only. This plan does not complete A+D overall and does not authorize Phase 7.

## Objective

Deliver LinkTerm's Workspace + J-Link/RTT download-and-observe slice on top of the Phase 5
Human Approval Broker. A user should be able to review J-Link/firmware/RTT readiness, request
a download-and-observe plan, approve it once, see existing workflow/job progress, understand
J-Link/RTT-specific failures, preserve known-good verified evidence safely, and optionally
save profile suggestions.

## Non-negotiable constraints

- Do not bypass `SessionManager`, `WriteQueue`, `Transport`, `IJLinkBackend`,
  `ControlWorkflowJobManager`, workspace/control-profile managers, or the Main trust
  boundary.
- Do not create a second approval system. New high-impact Phase 6 CTAs use Phase 5
  `PreparedOperation`, Broker, one-time grants, and original-surface continuation.
- `confirm=true`, Renderer button clicks, Activity actions, profile suggestions, and
  compensation summaries do not authorize hardware effects.
- Renderer/preload receive only display-safe DTOs.
- No real hardware side effects are authorized. Validation uses fake backends, spies, temp
  files, and mocks only.
- No cloud, database, default telemetry, generic chat UI, external installer, arbitrary repair
  script, Pause/Take Over, durable audit, or hardware rollback/checkpoint promise.

## Current-state facts to preserve

- Phase 5 evidence is recorded in `docs/engineering/phase-5-human-approval-evidence.md`.
- The worktree contains cumulative uncommitted Phase 0-5 changes; do not reset or clean it.
- GitNexus `detect_changes` against `main` is expected to remain high/critical while the
  cumulative worktree is uncommitted.
- Existing J-Link/RTT seams include:
  - `IJLinkBackend` and `src/jlink/` backend/client/runner contracts.
  - `runControlWorkflow` and `ControlWorkflowJobManager`.
  - `approval-preparer.ts` for control workflow effect binding.
  - RTT log session core/MCP tools.
  - Runtime Readiness and Start Center.
  - Activity Center and Approval Sheet.

## Implementation slices

### Slice 0 — Phase 6 characterization and impact ledger

1. Run and record current OpenSpec validation for `extend-first-success-jlink-rtt`.
2. Run focused baseline tests most likely to be touched:
   - shared readiness/approval/first-signal contracts;
   - core readiness;
   - control workflow runner/job manager;
   - human approval MCP/direct integration;
   - renderer Start Center/first-success/activity/approval.
3. For each existing symbol before editing, run `impact({ direction: "upstream" })` and
   record direct callers, affected processes, and risk.
4. If HIGH/CRITICAL appears for the selected edit, report it before editing.

Likely first impact targets:

- `ReadinessScopeSchema`, `ReadinessEvidenceSchema`, `ReadinessActionSchema`,
  `DeviceCandidateSchema`, `RuntimeReadinessSnapshotSchema`.
- `RuntimeReadinessService`, readiness provider builders, `resolveDeviceCandidates`.
- `runControlWorkflow`, `preflight`, `connectRttStep`, `observeRttStep`,
  `finalizeWorkflow`.
- `prepareMcpControlWorkflowApprovalOperation`, `buildPlanSteps`, `resolveFirmware`.
- `createMcpApprovalGate`, `createControlProfileApprovalGate` only if new continuation
  surfaces require them.
- `StartCenter`, `FirstSuccessFlow`, `ActivityCenterDrawer`, `ApprovalSheet`, `App`,
  `en`, `zh`.

### Slice 1 — Display-safe contracts and draft helpers

Tests first:

- Add shared schema tests for new J-Link/firmware/RTT scopes, evidence sources, actions,
  candidates, download-and-observe drafts, profile suggestions, and compensation summaries.
- Add strict unknown-field, length, basename, hash-prefix, secret-key, private-path, firmware
  bytes, backend-handle, raw-output, and internal-authority leak tests.

Implementation:

- Extend readiness/shared contracts or add a dedicated shared Phase 6 contract if extending the
  existing contract would create unsafe coupling.
- Add draft helper functions that preserve provenance but do not authorize effects.

Validation:

- `pnpm exec vitest run tests/unit/shared/readiness-contract.test.ts tests/unit/shared/approval-contract.test.ts`
- Add new shared tests to this focused command.

### Slice 2 — Read-only J-Link/firmware/RTT readiness

Tests first:

- No backend, backend available, no probe, multiple probes, target catalog hit/miss, target
  conflict, firmware absent/outside workspace/oversized/unparseable, RTT config absent.
- Provider failure isolation and latest-generation behavior.
- No-side-effect spies for connect/reset/halt/run/flash/erase/memory-write/rtt-connect/
  rtt-read/GDB-server/session-open/workspace/profile mutation.

Implementation:

- Add read-only provider(s) under `src/core/readiness/`.
- Reuse control-profile/workspace managers for read-only facts.
- Use `IJLinkBackend` only for safe status/detect/capability methods if available; do not call
  side-effect methods.

Validation:

- `pnpm exec vitest run tests/unit/core/readiness tests/unit/shared/readiness-contract.test.ts`

### Slice 3 — Approval-bound guided execution and reflash preparation

Tests first:

- New guided Download/Flash/Reflash CTA with `confirm=true` or button click creates pending
  approval and calls zero effectful backend methods.
- Valid continuation consumes once and calls existing workflow/backend path once.
- Replay, wrong consumer, wrong surface/mode, changed target/probe, changed firmware hash,
  changed profile/default, denial, expiry, quota, malformed payload all call zero effectful
  backend methods.

Implementation:

- Extend existing control workflow approval preparation rather than creating a new authority.
- Bind Phase 6 target/firmware/RTT plan metadata into effect fingerprints and manifest digest.
- Preserve legacy missing-acknowledgement compatibility where applicable.

Validation:

- `pnpm exec vitest run tests/integration/human-approval-mcp.test.ts tests/integration/high-impact-confirmation.test.ts`
- Add Phase 6 integration tests to this focused set.

### Slice 4 — Workflow/job diagnostics and RTT first-success evidence

Tests first:

- Workflow path: connect → flash → verify → reset → RTT observe → diagnostics.
- Failure paths: no backend, no probe, target error, firmware path/format, flash failed,
  verify failed, RTT connect failed, RTT read/search failed, RTT silent.
- Job progress and Activity projection use structured steps, not raw output parsing.

Implementation:

- Refine `runControlWorkflow` steps and next actions where needed.
- Reuse `ControlWorkflowJobManager`.
- Add RTT-specific first-success/diagnostic state without reusing serial silent copy.

Validation:

- `pnpm exec vitest run tests/unit/mcp/control-workflow-tools.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts`
- Add workflow runner tests if not already separated.

### Slice 5 — Main-only CompensationCandidate and safe reflash summary

Tests first:

- Candidate created only after verified success.
- New in-progress deployment does not erase previous known-good.
- Failed/unknown result does not overwrite known-good.
- Matching/mismatch logic covers source/hash/size/format/base address, target/probe binding,
  profile revision/defaults, workflow mode, manifest digest.
- Renderer summary excludes internal candidate, rollback object, firmware bytes, J-Link serial
  number, private path, backend handle, raw output, and internal fingerprint.

Implementation:

- Add Main-only core service, likely under `src/core/compensation/`.
- Add projection functions in Main or shared display-safe contract.
- Reflash CTA prepares a new approval; it never executes directly.

Validation:

- `pnpm exec vitest run tests/unit/core/compensation tests/unit/shared/*compensation*`

### Slice 6 — Renderer Start Center / first-success / Activity / Approval UI

Tests first:

- J-Link/RTT states: needs-backend, needs-probe, needs-target, needs-firmware,
  reviewing-plan, awaiting-approval, running-job, verifying, observing-rtt, rtt-silent,
  errored, completed.
- Recovery actions: refresh, edit workspace/profile, choose firmware, edit target, keep
  waiting, diagnose, open RTT log, retry, view activity, reflash, save/skip profile suggestion.
- Accessibility, keyboard, focus return, non-stealing late updates, small window.
- EN/ZH key coverage and no rollback wording.

Implementation:

- Extend existing Start Center and first-success feature reducer/components.
- Use Activity Center and Approval Sheet display-safe projections.
- Keep professional advanced connection paths available.

Validation:

- `pnpm exec vitest run tests/unit/renderer/readiness tests/unit/renderer/first-success tests/unit/renderer/activity tests/unit/renderer/approval tests/unit/renderer/App.test.tsx`

### Slice 7 — Profile suggestion

Tests first:

- Suggestion generated from verified success.
- User-confirmed save uses existing managers.
- Skip keeps completion.
- Save failure is safe and does not roll back completion or authorization.
- Suggestion does not claim stable hardware identity.

Implementation:

- Add suggestion projection and save-confirmation path only if an existing safe manager/API can
  support it without schema migration. Otherwise record a Phase 6 known limit.

Validation:

- Focused profile/workspace manager tests plus affected renderer tests.

### Slice 8 — Review and closeout

1. Run focused Phase 6 tests.
2. Run affected Phase 3-5 bridge tests.
3. Run `pnpm run lint`.
4. Run `pnpm run build`.
5. Run `pnpm run test`.
6. Run `pnpm run test:coverage`.
7. Run `pnpm run validate:licenses`.
8. Run `pnpm audit --prod`.
9. Request independent requirements/UI-accessibility and security/code-quality reviews.
10. Resolve valid review feedback and rerun affected checks.
11. Read and apply `verification-before-completion`.
12. Run `pnpm exec openspec validate extend-first-success-jlink-rtt --strict`.
13. Run `git diff --check` for Phase 6 docs/src/tests and no-index checks for untracked docs.
14. Run directed GitNexus PDG/taint checks for readiness, approval preparation, workflow,
    compensation, preload, and renderer boundaries.
15. Run `detect_changes({ scope: "compare", base_ref: "main" })`.
16. Record Phase 6 evidence in `docs/engineering/phase-6-jlink-rtt-evidence.md`.
17. Request explicit authorization before Phase 7.

## Done criteria for Phase 6

Phase 6 is complete only when:

- J-Link/firmware/RTT readiness is read-only and display-safe.
- New Download/Flash/Reflash CTAs use Phase 5 human approval and single-use continuations.
- Workflow execution stays inside existing managers and `IJLinkBackend`.
- RTT first-success/diagnostics are specialized and not confused with serial first signal.
- Known-good/reflash behavior is Main-only, evidence-bound, display-safe, and not described as
  rollback.
- Profile suggestions are user-confirmed and non-authorizing.
- A11y/i18n/performance/no-side-effect evidence is fresh.
- OpenSpec, tests, build, lint, coverage, license, audit, GitNexus PDG/taint, and
  detect_changes evidence are recorded.
- Phase 7 has not started without explicit authorization.
