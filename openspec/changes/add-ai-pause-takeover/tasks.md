## Phase 7 closeout evidence — 2026-07-15

Status: Phase 7 Pause / Take Over is implemented and verified for this change scope. This is not A+D completion; Phase 8 Durable Audit remains.

### Fresh validation evidence

- OpenSpec:
  - `pnpm exec openspec validate add-ai-pause-takeover --strict` → `Change 'add-ai-pause-takeover' is valid`.
  - `pnpm exec openspec validate --all --strict` → 42 passed, 0 failed.
- TDD/focused regression:
  - `pnpm exec vitest run tests/unit/main/ipc/ai-control-ipc.test.ts` first failed for untrusted unsubscribe returning success; fixed by validating sender before unsubscribe.
  - `pnpm exec vitest run tests/unit/core/ai-control/operation-admission-coordinator.test.ts` first failed for pause-during-approval-consume executing the effect; fixed by rechecking pause after approval consume and before lease acquisition.
  - Final Phase 7 focused suite:
    `pnpm exec vitest run tests/unit/shared/ai-control-contract.test.ts tests/unit/core/ai-control tests/unit/main/ipc/ai-control-ipc.test.ts tests/unit/main/preload-ai-control.test.ts tests/unit/fixtures/mock-preload-api.test.ts tests/unit/mcp/registry.test.ts tests/unit/mcp/terminal-tools.test.ts tests/unit/main/ipc/control-profile-approval-gate.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/integration/human-approval-mcp.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/renderer/ai-control tests/unit/renderer/activity tests/unit/renderer/approval tests/unit/renderer/App.test.tsx tests/unit/renderer/components/SessionTabBar.test.tsx tests/unit/renderer/components/TerminalView.test.ts`
    → 29 files, 321 tests passed.
- Phase 1–6 bridge regression:
  - `pnpm exec vitest run tests/unit/renderer/readiness tests/unit/renderer/first-success tests/unit/renderer/activity tests/unit/renderer/approval tests/unit/mcp/runtime-control-tools.test.ts tests/unit/mcp/agent-runbook.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/integration/human-approval-mcp.test.ts tests/integration/operation-ledger-mcp.test.ts`
    → 23 files, 210 tests passed before final admission-race fix; final full suite below re-covered the repository after the fix.
- Quality gates after final fixes:
  - `pnpm run lint` → passed.
  - `pnpm run build` → passed; Vite emitted chunk-size warning only.
  - `pnpm run test` → 185 files, 2053 tests passed.
  - `pnpm run test:coverage` → 185 files, 2053 tests passed; statements 82.41%, branches 73.95%, functions 85.04%, lines 84.84%.
  - `pnpm run validate:licenses` → PASS: 19 runtime dependencies and 29 packages in 1 audited dev-tooling production closure have valid license entries.
  - `corepack pnpm@latest --pm-on-fail=ignore audit --prod` → No known vulnerabilities found; newer pnpm warned that package.json `pnpm.supportedArchitectures` is ignored.
  - `git diff --check` → exit 0; LF→CRLF warnings only, no whitespace errors.
- GitNexus / PDG / taint:
  - `registerAiControlIpc` upstream impact before fixing unsubscribe sender validation → LOW, direct=1, affected process `registerIpcHandlers`.
  - `OperationAdmissionCoordinator` upstream impact before fixing approval/pause race → MEDIUM, direct=5, affected process `registerIpcHandlers`.
  - Directed `explain` taint checks in this Phase 7 closeout found 0 findings for `src/core/ai-control/operation-admission-coordinator.ts`, `src/mcp/approval-gate.ts`, `src/main/ipc/control-profile-approval-gate.ts`, and `src/mcp/surfaces/terminal/tools.ts`; earlier Phase 7 taint checks also covered `src/mcp/surfaces/control-workflow/job-manager.ts`, `src/main/preload.ts`, and `src/renderer/features/ai-control/use-ai-control.ts`. Absence of findings is not a safety proof.
  - PDG/controls evidence from this closeout included `src/mcp/registry.ts` (75 control-dependence edges), `src/mcp/surfaces/terminal/tools.ts` (54), `src/main/ipc/control-profile-approval-gate.ts` (31), plus CLI PDG `impact --mode pdg` for `ControlWorkflowJobManager`, preload `api`, and final `OperationAdmissionCoordinator`. PDG mode reports UNKNOWN by design and uses a callgraph bridge for interprocedural symbol reach.
  - `node .gitnexus/run.cjs analyze` was attempted to refresh new-file indexing and timed out after 60 seconds, so no refreshed-index success is claimed.
  - Final `node .gitnexus/run.cjs detect_changes --scope compare --base-ref main --repo link-mcp` → 58 files, 492 symbols, 45 affected processes, risk critical. This is the cumulative Phase 0–7 dirty worktree, not a standalone Phase 7-only low-risk signal.
- Review:
  - Requested broad Phase 7 code/security review; it timed out and was interrupted.
  - Requested narrower Phase 7 quick review; it found one Critical issue: pause could be toggled while `consumeApproval()` awaited and the operation would still acquire a lease/run effects.
  - Fixed the review finding with a red-green regression test in `tests/unit/core/ai-control/operation-admission-coordinator.test.ts`; final focused/full/coverage gates passed after the fix.

### Hardware/no-side-effect evidence

- No real flash, erase, reset, probe attach, GDB server, RTT server, serial payload write, or hardware recovery command was executed in this closeout.
- Validation used Vitest, mocks/spies/fake backends/temp-file stores, OpenSpec validation, Git/GitNexus read-only analysis, license validation, build, and pnpm audit.
- Existing tests that mention flash/reset/GDB/RTT use fake backends or dry-run/mocked flows; no real hardware command was invoked by this Phase 7 work.

## 1. Phase 7 scope, entry, and impact gates

- [x] 1.1 Reconfirm Phase 6 evidence, dirty worktree, absence/presence of existing Phase 7 implementation, and OpenSpec status before product-code implementation.
- [x] 1.2 Record fresh GitNexus upstream-impact results for every existing function, class, method, interface, shared schema, or React component selected for modification; report HIGH/CRITICAL blast radius before editing.
- [x] 1.3 Keep Phase 7 limited to AI Pause, capability-aware Stop, and Take Over; do not implement durable audit/export/clear, cloud/telemetry/database, remote approval, generic chat UI, new installers, new hardware side-effect capability, or hardware rollback promises.
- [x] 1.4 Prove every Phase 7 validation run uses fake backends/spies/temp files/mocks only and executes no real flash, erase, reset, probe attach, GDB server, RTT server, serial payload write, or workspace-destructive action.

## 2. Core AI control state, persistence, and display-safe contracts

- [x] 2.1 Add failing shared/core tests for versioned global/session pause state, effective OR semantics, idempotent pause/resume, session-only Take Over latch, corrupt/missing persistence fallback, and restart persistence.
- [x] 2.2 Implement `AiControlService` state transitions and userData persistence without introducing durable operation audit/export/clear.
- [x] 2.3 Add failing shared DTO tests proving Renderer snapshots/events omit `PreparedOperation`, grants, authorization records, caller principal ids, execution leases, internal epochs/fingerprints, compensation internals, raw errors/stacks, and unknown fields.
- [x] 2.4 Implement display-safe AI control contracts and bounded diagnostics.

## 3. Operation admission coordinator and lease lifecycle

- [x] 3.1 Add failing pure tests for admission lease acquisition, pause-vs-admission linearization, global/session epoch binding, double release idempotence, runtime restart invalidation, read-only allow, human/system allow, and state-affecting AI block.
- [x] 3.2 Implement `OperationAdmissionCoordinator` with Main-only `ExecutionAdmissionLease` creation/release and serialized admission transactions.
- [x] 3.3 Add failing integration tests proving approved-but-paused operations stay blocked until explicit resume and revalidation, expired-while-paused grants do not execute, wrong consumers preserve grants, and effectful backend call count remains 0 when pause blocks admission.
- [x] 3.4 Integrate pause admission into existing MCP/direct high-impact continuation paths without moving approval authority out of Main.

## 4. Session AI writes and Take Over

- [x] 4.1 Add failing session/write tests proving AI-origin writes are blocked by effective pause before `WriteQueue.enqueue`, while human/system writes and human `priority:'high'` continue through existing ordering.
- [x] 4.2 Implement session write admission through the existing `SessionManager`/session write seam without bypassing `WriteQueue` or transport.
- [x] 4.3 Add failing Take Over tests proving it pauses only the selected session latch, preserves global pause state, focuses the existing terminal, shows human-control copy, does not close the session, and injects no terminal payload.
- [x] 4.4 Implement Take Over IPC/service path and renderer focus integration using display-safe session ids only.

## 5. Capability-aware Stop and running-operation projections

- [x] 5.1 Add failing job/activity tests for cancellation capability `none`, `best-effort`, and `safe-point`, plus distinct `stop-requested`, `cancelled`, `failed-after-stop-request`, and `succeeded-after-stop-request` projections.
- [x] 5.2 Implement capability declarations in existing job/backend projections and ensure `AbortSignal` is not treated as proof of safe stop.
- [x] 5.3 Add failing renderer tests proving `safe-point` shows `Stop at safe point`, `best-effort` shows `Request stop (best effort)`, `none` shows no stop button, and no copy promises rollback/undo.
- [x] 5.4 Wire stop requests through existing `ControlWorkflowJobManager`/backend cancellation seams only.

## 6. Main IPC, preload, mock bridge, and renderer UI

- [x] 6.1 Add failing Main/preload/mock tests for `aiControl` snapshot, subscribe/event ordering, pause/resume commands, Take Over command, sender validation, stale revisions, malformed payloads, and display-safe projection.
- [x] 6.2 Implement `aiControl` IPC/preload namespace and test fixture helpers.
- [x] 6.3 Add failing renderer reducer/component tests for paused capsule priority, badges for pending/approved/attention while paused, Activity Center blocked-by-pause cards, Approval Sheet `Approved · paused`, session pause indicators, and Take Over focus return.
- [x] 6.4 Implement renderer controls in the existing shell, Activity Center, Approval Sheet, and session surfaces.

## 7. Accessibility, i18n, performance, and scope guards

- [x] 7.1 Add failing EN/ZH key-coverage tests for every new pause, resume, takeover, stop, blocked, approved-paused, running-with-lease, diagnostic, disabled-reason, and no-rollback string.
- [x] 7.2 Add failing accessibility tests for keyboard operation, distinct accessible names, non-color-only paused state, focus return, reduced-motion-safe presentation, and small-window behavior.
- [x] 7.3 Add bounded rendering/performance tests for many paused sessions, blocked operations, running jobs, and high-frequency read-only activity while paused.
- [x] 7.4 Add scope-guard tests proving Phase 7 introduces no durable audit/export/clear, database/cloud/telemetry, generic chat UI, external installer, hardware rollback wording, or new real hardware side-effect path.

## 8. Focused validation slices

- [x] 8.1 Run focused tests after each vertical slice: AI control core, admission coordinator, approval continuation, session write/takeover, job capability stop, IPC/preload, renderer pause UI, i18n/a11y/performance.
- [x] 8.2 Run affected Phase 1-6 bridge tests to prove Activity Center, Runtime Readiness, Serial First Signal, Human Approval, and J-Link/RTT flows did not regress.
- [x] 8.3 Run lint, production build, full tests, coverage report, runtime/tooling license validation, and production dependency audit with fresh output.

## 9. Review and closeout

- [x] 9.1 Request independent requirements/UI-accessibility and code-quality/security reviews; resolve every valid finding and rerun affected checks.
- [x] 9.2 Run verification-before-completion, OpenSpec strict validation, `git diff --check`, directed GitNexus PDG/taint checks for admission/approval/session/write/job/preload/renderer boundaries, and `detect_changes` against `main`.
- [x] 9.3 Record Phase 7 evidence, known limits, no-hardware-side-effect evidence, pause/admission/lease/takeover/stop/i18n/a11y/performance results, and explicitly request authorization before Phase 8.

## Completion notes

- Phase 7 completion may claim Pause / capability-aware Stop / Take Over only. It must not be described as A+D completion.
- Durable Audit remains Phase 8 and requires explicit authorization before work begins.
