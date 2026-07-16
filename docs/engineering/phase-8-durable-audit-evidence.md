# Phase 8 Evidence: add-durable-audit

Date: 2026-07-15
Status: Phase 8 implementation and verification complete for this change scope. This is not a
claim that the cumulative A+D worktree is committed or that a real hardware demonstration was
performed.

## Delivered boundary

- Main-owned `AuditStore` persists only validated `ActivityEventView` envelopes under
  Electron `userData/activity/`.
- JSONL writes use a batched serial queue independent from Ledger, MCP response, transport, and
  renderer event delivery.
- Defaults are enabled, 30-day retention, 10 MiB file rotation; startup recovery is bounded to
  10,000 events and 16 MiB of inspected bytes.
- Recovery walks newest files first, preserves the newest bounded events, ignores a damaged tail
  line with a safe warning, and never invents a new operation terminal state.
- Main-only status/export/clear IPC uses strict schemas and trusted BrowserWindow sender checks.
  Export writes JSON/JSONL below the Main-owned export directory and returns only a filename,
  count, format, and redaction marker. Clear requires an explicit `{ confirm: true }` request;
  the preload no longer synthesizes confirmation.
- Activity Center shows bounded status, export feedback, explicit two-step deletion, keyboard
  focus behavior, visible non-color state, and English/Chinese labels.

## TDD and review evidence

- Initial audit-store test run failed because `audit-store.ts` did not exist; implementation
  then made the focused suite green.
- Review found and fixed: preload-synthesized clear confirmation, oldest-file recovery, missing
  startup byte budget, and retention not pruning long-running memory/export state. Regression
  tests cover each fix (`tests/unit/core/activity/audit-store.test.ts`, preload and Activity
  Center tests).
- No agent reported an unresolved Critical/Important Phase 8 issue after the fixes. The review
  was read-only; no unreviewed code was accepted from an agent.

## Fresh verification

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/core/activity/audit-store.test.ts tests/unit/shared/audit-contract.test.ts tests/unit/main/ipc/audit-ipc.test.ts tests/unit/main/preload-activity.test.ts tests/unit/renderer/activity/activity-components.test.tsx tests/unit/fixtures/mock-preload-api.test.ts tests/unit/main/ipc/index.test.ts` | PASS: 7 files / 55 tests |
| `pnpm run test` | PASS: 188 files / 2,069 tests |
| `pnpm run ci:check` | PASS: lint, build, 188 files / 2,069 tests, and license validation |
| `pnpm run test:coverage` | PASS: 188 files / 2,069 tests; statements 82.49%, branches 73.97%, functions 85.15%, lines 84.96% |
| `pnpm run lint` | PASS |
| `pnpm run build` | PASS; Vite emitted only the existing chunk-size warning |
| `pnpm run validate:licenses` | PASS: 19 runtime dependencies and 29 audited dev-tooling closure packages |
| `corepack pnpm@latest --pm-on-fail=ignore audit --prod` | PASS: no known vulnerabilities; pnpm warned that `pnpm.supportedArchitectures` is ignored |
| `pnpm exec openspec validate add-durable-audit --strict` | PASS |
| `pnpm exec openspec validate --all --strict` | PASS: 43/43 |
| `git diff --check` | PASS (only existing LF→CRLF warnings) |

## GitNexus / PDG / taint evidence

- Before edits, `OperationLedger` upstream impact was HIGH (26 impacted, 18 direct, 2
  processes); `PreloadAPI` was CRITICAL (91 impacted, 43 direct); `registerActivityIpc`,
  `registerIpcHandlers`, and `ActivityCenterDrawer` were LOW. These blast-radius warnings were
  reported before editing and the existing Ledger/handler semantics were preserved.
- `node .gitnexus/run.cjs analyze` completed successfully (incremental changed=7, added=2);
  the explicit `node .gitnexus/run.cjs analyze --pdg --index-only` refresh also completed;
  the resulting index reports 42,886 nodes, 78,666 edges, and 300 flows.
- Final `detect_changes({scope:'compare', base_ref:'main'})` reports the cumulative dirty
  Phase 0–8 worktree: 58 files, 528 changed symbols, 51 affected processes, `critical` risk.
  This is cumulative and intentionally not presented as a Phase 8-only diff proof; no commit,
  push, PR, or worktree cleanup was performed.
- Directed `explain` for audit store, audit IPC, preload, Activity Center, and audit contract
  returned 0 persisted taint findings. GitNexus explicitly says absent findings are not proof;
  closure/property/implicit flows remain outside the model.
- Directed PDG controls returned 164 bounded/truncated edges for `audit-store.ts` and 19 for
  `audit-ipc.ts`; these are dependence evidence, not a security proof.

## Deliberate non-goals

No database, cloud sync, telemetry, remote approval, generic chat UI, external installer, real
flash/erase/reset/probe/GDB/RTT/serial side effect, terminal transcript persistence, raw script or
binary persistence, or hardware rollback promise was added.
