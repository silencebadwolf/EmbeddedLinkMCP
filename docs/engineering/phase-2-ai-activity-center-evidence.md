# Phase 2 Evidence: add-ai-activity-center

Date: 2026-07-13

Status: Phase 2 closeout evidence captured. This document covers Phase 2 only. It does not claim Phase 3–8 or the overall A+D goal is complete.

## Scope

Phase 2 implements a read-only renderer Activity Center over the Phase 1 Main-owned activity bridge:

- AI status capsule with idle, running, awaiting-approval, and attention-needed display states. This is display-only and does not grant approval authority.
- Activity Center drawer with default active/attention view, history mode, filters, folded read-only bursts, safe details, workflow progress, loading/error/truncation states, visible disabled reasons, focus loop, focus return on close when possible, and bounded visible rows.
- Renderer hydration from `window.linkterm.activity` with listener-before-subscribe ordering, pending event buffering, snapshot cut replacement, cursor persistence/clearing, invalid stored-cursor retry, gap/runtime-reset resnapshot, stale resnapshot guards, truncation diagnostics, safe subscribe failure handling, and cleanup.
- Session-origin entry that opens Activity Center filtered by `sessionId` while preserving existing origin-dot semantics and exposing AI/Human/System activity state in its accessible name.
- Context actions: `Go to session`, disabled `Diagnose` with reason, and bounded `Copy summary`.
- English and Chinese UI copy for new labels/actions/statuses/errors/fallbacks.
- Renderer-local retained-state caps aligned with Phase 1 snapshot limits; local truncation marks `historyTruncated`.

Explicitly out of scope for Phase 2:

- Runtime Readiness / Start Center.
- Serial First Signal completion.
- Human Approval Broker, grants, approval continuation, `PreparedOperation`, `AuthorizationRecord`, `CallerPrincipalId`, `Lease`, or `CompensationCandidate`.
- Pause / Take Over.
- Durable JSONL audit, export, clear, retention, database, cloud service, remote approval, default telemetry, or hardware rollback promises.
- Real flash, erase, reset, J-Link, RTT, serial-write, GDB-server, or hardware-observe validation side effects.

## Display-safe and trust-boundary evidence

- Renderer activity state is derived from `ActivitySnapshotViewSchema` / `ActivityEventViewSchema` and rejects unknown fields through strict Zod parsing.
- Renderer stores summarized operation/call state only: actor, action, risk, phase, display-safe target refs, safe error codes, bounded progress, and call attempt summaries.
- Subscription rejection becomes `subscribe-failed`; raw `Error`, stack, `ipcRenderer`, raw payloads, raw terminal transcript, scripts, binary/firmware data, credentials, tokens, screenshots, raw evidence, and Main-only approval objects are not retained in React state.
- `Diagnose` is disabled in Phase 2 when no safe existing diagnostic route is available, and the disabled reason is visible in the drawer.
- `Copy summary` is bounded to 512 characters and is built from display-safe reducer summaries.
- `Go to session` only focuses an existing renderer session; it does not create a session or call backend/hardware operations.

## GitNexus impact evidence

Existing product-symbol edits were gated by upstream impact before modification.

Recorded impacts during Phase 2:

- `App`, `OriginIndicator`, `SessionTabBar`, `useAppStore`, `createMockPreloadAPI`, and i18n exports were checked before their respective edits during implementation.
- `useAppStore`: max MEDIUM, 12 direct / 30 impacted; Phase 2 only added non-stealing regression coverage and did not change product store focus logic.
- `addSession`: ambiguous Function / Interface Method candidates, LOW / 0 direct; no product logic changed.
- `en` / `zh`: LOW / 0 direct.
- `createActivityHydrationController`: LOW, 1 direct dependency, affected process `App`.
- `useActivityCenterState`: LOW, 1 direct dependency, affected process `App`.
- `ActivityCenterDrawer`: LOW, 1 direct caller (`App`), Components module.
- `ActivityOperationCard`: LOW, 1 direct caller, affected processes `ActivityCenterDrawer` and `App`.
- `App`: LOW, 1 direct test dependency.
- `AiStatusCapsule`: LOW, 1 direct caller (`App`), Components module.
- `SessionTabBar`: LOW, 1 direct test dependency.
- `OriginIndicator`: LOW, 2 direct dependencies, affected process `SessionTabBar`.
- `applyTrustedEvent`: HIGH, 2 direct dependencies, 9 impacted symbols, 4 affected flows (`onEvent`, `resnapshotAfterGap`/renamed resnapshot path, `start`, `ingestActivityEvent`), Activity module. The follow-up retained-window cap was intentionally limited to renderer reducer state and covered by focused/full tests.
- PDG-mode impacts for activity renderer/preload boundaries may report UNKNOWN by GitNexus PDG contract and must not be treated as proof of safety.

No single-symbol CRITICAL upstream impact was reported before editing.

## Independent review evidence

Two independent read-only reviews were requested:

- Requirements/UI/accessibility review.
- Code-quality/security review.

Initial high-confidence findings and resolution:

- Invalid/stale activity cursors did not fall back to a fresh subscription: fixed with one-shot fresh subscribe retry and stale cursor clearing.
- Session-origin entry used a broad `targetId` filter: fixed to `sessionId`, with a collision regression test.
- Escape/close did not return focus to the opener: fixed in `App`, with capsule and origin-entry focus-return tests.
- Capsule did not expose pending approval distinctly: fixed with display-only awaiting-approval status and EN/ZH copy.
- Unknown workflow-step fallback was an untranslated literal: fixed with EN/ZH fallback key and test.
- Disabled action reasons were title-only: fixed with visible disabled reasons and test.
- Renderer live state was unbounded: fixed with local event/operation caps and truncation tests.
- Gap resnapshot could apply after stop or overwrite newer state: fixed with generation/stopped guards, monotonic cursor checks, and tests.
- Session origin entry was an interactive role inside a tab trigger: fixed by rendering the origin activity button as a sibling control outside `TabsTrigger`.
- Task/evidence overclaimed 10k/terminal-adjacent coverage: kept implementation evidence conservative; current automated evidence is bounded rows for 1,000 operations, local cap at 5,000 events / 1,000 operations, plus App-level terminal-adjacent focused coverage.

Reviewer follow-up rechecks were attempted after fixes, but both follow-up agent turns failed due an external stream-disconnect error. The valid findings above were resolved and affected checks were rerun locally.

## Fresh validation evidence

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/renderer/activity/activity-reducer.test.ts tests/unit/renderer/activity/activity-hydration.test.ts tests/unit/renderer/activity/activity-components.test.tsx tests/unit/renderer/App.test.tsx tests/unit/renderer/components/OriginIndicator.test.tsx tests/unit/renderer/components/SessionTabBar.test.tsx` | PASS: 6 files / 70 tests |
| `pnpm exec vitest run tests/unit/shared/activity-contract.test.ts tests/unit/main/preload-activity.test.ts tests/unit/main/ipc/activity-ipc.test.ts tests/integration/operation-ledger-mcp.test.ts tests/unit/renderer/activity tests/unit/renderer/App.test.tsx tests/unit/renderer/components/OriginIndicator.test.tsx tests/unit/renderer/components/SessionTabBar.test.tsx tests/unit/renderer/store/app-store.test.ts` | PASS: 11 files / 130 tests |
| `pnpm run lint` | PASS |
| `pnpm run build` | PASS, with existing Vite chunk-size warning |
| `pnpm run test` | PASS: 124 files / 1686 tests |
| `pnpm run test:coverage` | PASS: 124 files / 1686 tests; statements 81.24%, branches 72.82%, functions 82.64%, lines 83.65% |
| `pnpm run validate:licenses` | PASS: 19 runtime deps and 29 packages in audited dev-tooling production closure |
| `pnpm audit --prod` | PASS: no known vulnerabilities |
| `pnpm exec openspec validate add-ai-activity-center --strict` | PASS |
| `git diff --check` | PASS, LF→CRLF warnings only |

## Accessibility, i18n, and performance evidence

Automated renderer coverage includes:

- Capsule accessible names for idle/running/awaiting-approval/attention status.
- Drawer `dialog` role, `aria-modal`, keyboard open path, focus placement on open, Escape close, focus return to opener when possible, and Tab / Shift+Tab focus loop inside the drawer.
- Reduced-motion-safe status comprehension through stable text and roles.
- English and Chinese strings for new Activity Center chrome/action/status/error/fallback copy.
- Session origin entry accessible name includes AI/Human/System activity states.
- Bounded rendering for 1,000 retained operations: 50 operation rows are rendered, with a visible “Showing 50 of 1000 operations” summary.
- Renderer retained state caps are covered for 5,000 events and 1,000 operations.

## GitNexus PDG / taint / detect_changes evidence

Latest PDG reindex:

- `node .gitnexus/run.cjs analyze --pdg`
- PASS: 31,597 nodes / 58,925 edges / 447 clusters / 300 flows
- Warning: Node DEP0190 from GitNexus runner shell args; not an analysis failure.

Directed taint anchors recorded 0 findings for:

- `src/renderer/features/activity/activity-reducer.ts`
- `src/renderer/features/activity/activity-hydration.ts`
- `src/renderer/features/activity/ActivityCenterDrawer.tsx`
- `src/renderer/features/activity/useActivityCenterState.ts`
- `src/main/preload.ts`
- `tests/fixtures/mock-preload-api.ts`
- `src/main/ipc/activity-ipc.ts`
- `src/shared/preload-api.ts`

PDG control checks:

- `ingestActivitySnapshot`: total 3 controls.
- `createActivityHydrationController`: total 57 controls.
- `ActivityCenterDrawer`: total 10 controls.

`detect_changes({ scope: "compare", base_ref: "main" })` result:

- CRITICAL: 39 changed files / 164 changed indexed symbols / 28 affected processes.
- This is expected for the cumulative dirty Phase 0 + Phase 1 + Phase 2 worktree and is not a Phase 2-only safety proof.
- The affected process list includes Phase 0/1 surfaces such as control profile IPC, MCP registry/control workflow, preload activity bridge, and Phase 2 renderer surfaces.

Caveat: GitNexus taint 0 findings is not a proof of safety. Phase 2 safety also depends on schema strictness, display-safe DTO design, reducer allowlisting, UI tests, review fixes, and no later-phase authority crossing into Renderer.

## Known warnings and limits

- Worktree remains intentionally dirty with Phase 0, Phase 1, and Phase 2 uncommitted changes. Do not reset or clean it.
- `detect_changes(compare main)` is CRITICAL because Phase 0/1/2 are all uncommitted in one worktree.
- Vite warns about chunks larger than 500 KiB during production build; this is not currently configured as a failure.
- `git diff --check` emits LF→CRLF normalization warnings on Windows and exits 0.
- `Follow AI` is not exposed in Phase 2, so no renderer-local follow state was introduced. Existing AI-created session non-stealing behavior is locked by regression coverage.
- No real hardware side-effect validation was performed.
