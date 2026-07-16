# Phase 1 Operation/Event Ledger Evidence

Date: 2026-07-13

Scope: Phase 1 `add-operation-event-ledger` only. This does not complete the full A+D
goal or authorize Phase 2.

## Verification commands

- `pnpm exec vitest run tests/unit/shared/activity-contract.test.ts tests/unit/core/activity/activity-event.test.ts tests/unit/core/activity/operation-state.test.ts tests/unit/core/activity/activity-health.test.ts tests/unit/core/activity/risk-policy.test.ts tests/unit/core/activity/audit-redactor.test.ts tests/unit/core/activity/operation-ledger.test.ts tests/unit/core/activity/operation-recorder.test.ts tests/unit/mcp/registry.test.ts tests/unit/mcp/registry-sdk-boundary.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/unit/main/ipc/activity-ipc.test.ts tests/unit/main/preload-activity.test.ts tests/unit/main/ipc/index.test.ts tests/unit/main/electron-runtime.test.ts tests/unit/mcp/http-runtime-server.test.ts tests/integration/high-impact-confirmation.test.ts tests/integration/operation-ledger-mcp.test.ts tests/unit/mcp/tool-risk-inventory.test.ts`
  - Result: 21 files, 683 tests passed.
- `pnpm run lint`
  - Result: passed.
- `pnpm run build`
  - Result: passed. Vite still reports a non-failing renderer chunk-size warning.
- `pnpm run test`
  - Result: 121 files, 1639 tests passed.
- `pnpm run test:coverage`
  - Result: 121 files, 1639 tests passed; statements 80.87%, branches 72.50%, functions 81.90%, lines 83.27%.
- `pnpm run validate:licenses`
  - Result: 19 runtime dependencies and 29 packages in 1 audited dev-tooling production closure have valid license entries.
- `pnpm audit --prod`
  - Result: no known vulnerabilities found.
- `pnpm exec openspec validate add-operation-event-ledger --strict`
  - Result: valid.
- `git diff --check`
  - Result: passed with Windows CRLF working-copy warnings only.
- `node .gitnexus/run.cjs analyze --pdg`
  - Result: repository indexed successfully; 30,501 nodes, 57,078 edges, 436 clusters, 300 flows.

## Review resolution

- Requirements/spec review: no Critical findings.
  - Important finding fixed: OpenSpec task 3.1 was stale and is now marked complete after verifying the state-machine tests.
- Code-quality/security review: no Critical findings.
  - Important finding fixed: inverse `CONFIRMATION_REQUIRED` policy drift after a started MCP call now records policy drift and terminates as a legal failure lifecycle instead of attempting an invalid rejection transition.
  - Important finding fixed: Activity IPC now treats only `undefined` as an omitted request; `null` subscribe/snapshot/unsubscribe payloads are rejected and do not mutate subscription state.

## GitNexus evidence

- Fresh upstream impact was run before product-code edits.
  - `registerTool`: HIGH, 11 direct dependents, 1 affected process, 3 modules.
  - `finishFailureRecording`: HIGH, 1 direct dependent, 1 affected process, 3 modules.
  - `registerActivityIpc`: LOW, 1 direct dependent, 0 affected processes, 1 module.
- Directed taint `explain` was run for:
  - `src/mcp/registry.ts`
  - `src/core/activity/audit-redactor.ts`
  - `src/core/activity/operation-recorder.ts`
  - `src/main/ipc/activity-ipc.ts`
  - `src/main/preload.ts`
  - `src/main/ipc/index.ts`
  - Result: 0 findings for each target. This is not a security proof; GitNexus notes closure/callback, property/field, and implicit flows are not fully modeled.
- Directed PDG controls were checked for registry failure handling, Activity IPC request validation, redaction projection, preload event parsing, and Main IPC runtime composition.
- `detect_changes({ scope: "compare", base_ref: "main" })` reported CRITICAL: 146 changed indexed symbols, 30 tracked changed files, 18 affected processes.
  - Caveat: this worktree intentionally contains uncommitted Phase 0 + Phase 1 changes together, so the result is a whole-dirty-tree scope check, not an isolated last-edit diff.

## Acceptance counters

- Normal acceptance evidence is covered by `tests/integration/operation-ledger-mcp.test.ts`, which asserts a shared direct + HTTP MCP ledger run has:
  - `captureFailureCount: 0`
  - `droppedEventCount: 0`
  - `evictedEventCount: 0`
  - `incompleteLifecycleCount: 0`
- Small-capacity pressure evidence is separate in `tests/unit/core/activity/operation-ledger.test.ts` and `tests/unit/core/activity/operation-recorder.test.ts`, where nonzero capture/drop/eviction counters are intentionally exercised.

## Known Phase 1 limits

- The ledger is in-memory only.
- Phase 1 does not add Activity Center UI, production approval continuation, Pause/Resume, durable audit persistence/export, cloud accounts, databases, remote approval, default telemetry, generic chat UI, or hardware rollback promises.
- `src/mcp/stdio-entry.ts` remains documented as legacy/non-default and not covered by the Main-owned queryable ledger topology.
- No real flash, erase, reset, J-Link, RTT, serial, or other hardware side effects were executed for this phase.
