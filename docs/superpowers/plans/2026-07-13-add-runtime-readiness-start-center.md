# Implementation Plan: Phase 3 `add-runtime-readiness-start-center`

Date: 2026-07-13

This plan implements only `openspec/changes/add-runtime-readiness-start-center`. It assumes Phase 0, Phase 1, and Phase 2 remain unarchived and uncommitted in the current dirty worktree. It must not enter Phase 4 or implement Serial First Signal, Human Approval, J-Link/RTT-specific readiness, Pause/Take Over, durable audit, telemetry, cloud services, databases, or hardware rollback promises.

## Phase 3 intent

Deliver a safe, read-only Runtime Readiness model and task-oriented Start Center:

- Main/core collects runtime, serial, optional workspace/profile, reusable session, and agent-integration facts.
- Renderer receives strict display-safe readiness DTOs only.
- Start Center replaces the no-session empty canvas, shows readiness/candidates/manual entry/recent suggestions, and keeps `Advanced connection…`.
- Before Phase 4, primary observe-device actions route to existing connection flows or stay feature-flagged; they must not claim first-signal success.

## Hard boundaries

- No session create/open from readiness refresh or Start Center render.
- No serial write, DTR/RTS toggle, reset, flash, GDB/J-Link/RTT process launch, install, workspace/profile mutation, or backend hardware action without an explicit existing user connection action.
- Do not bypass existing `SessionManager`, `WriteQueue`, `Transport`, `IJLinkBackend`, MCP registry, Activity Ledger, or Main trust boundary.
- Renderer must not receive raw provider objects, raw errors/stacks, full paths beyond approved display aliases, credentials, scripts, firmware/binary data, terminal transcript, PreparedOperation, grants, leases, authorization records, or compensation candidates.
- Do not change existing MCP tool result shapes or current `confirm=true` acknowledgement semantics.
- Do not commit, push, archive OpenSpec, or run real hardware side-effect commands.

## Expected files

New likely files:

- `src/core/readiness/readiness-contract.ts`
- `src/core/readiness/runtime-readiness-service.ts`
- `src/core/readiness/device-candidate-resolver.ts`
- `src/core/readiness/serial-connection-draft.ts`
- `src/core/readiness/readiness-preferences.ts`
- `src/shared/readiness-contract.ts`
- `src/main/ipc/readiness-ipc.ts`
- `src/renderer/features/readiness/readiness-reducer.ts`
- `src/renderer/features/readiness/readiness-hydration.ts`
- `src/renderer/features/readiness/useReadinessState.ts`
- `src/renderer/features/start-center/StartCenter.tsx`
- `src/renderer/features/start-center/ReadinessChecklist.tsx`
- `src/renderer/features/start-center/DeviceCandidateList.tsx`
- `src/renderer/features/start-center/ManualPortEntry.tsx`
- Tests under `tests/unit/core/readiness/`, `tests/unit/main/ipc/`, `tests/unit/main/preload-readiness.test.ts`, `tests/unit/renderer/readiness/`, and `tests/unit/renderer/start-center/`.

Existing files likely touched after impact:

- `src/shared/ipc-protocol.ts`
- `src/shared/preload-api.ts`
- `src/main/preload.ts`
- `src/main/ipc/index.ts`
- `src/main/ipc/serial-ipc.ts` if a provider seam is needed
- `src/mcp/surfaces/agent-runbook/tools.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/ConnectionDialog.tsx`
- `src/renderer/i18n/en.ts`
- `src/renderer/i18n/zh.ts`
- `tests/fixtures/mock-preload-api.ts`

Every existing function/class/method/interface/shared object above must get fresh GitNexus upstream impact before modification.

## Execution slices

### Slice 0 — Entry gate

1. Validate the new OpenSpec change:
   - `pnpm exec openspec validate add-runtime-readiness-start-center --strict`
2. Record current dirty worktree.
3. Re-read Phase 2 evidence and confirm Phase 3 is the only active phase.
4. List intended existing symbols for impact.

### Slice 1 — Shared contracts

TDD first:

- Add tests for strict schemas, unknown-field rejection, bounds, display-safe path/diagnostic behavior, generation metadata, and DTO immutability.
- Implement shared/core contracts only after tests fail.

Expected verification:

- `pnpm exec vitest run tests/unit/shared/readiness-contract.test.ts tests/unit/core/readiness/readiness-contract.test.ts`

### Slice 2 — Pure aggregation and providers

TDD first:

- Add tests for provider partial failure, timeout, abort, stale generation, no workspace, serial loading/empty/error/ready, reusable sessions, and agent integration.
- Run impacts before extracting existing app-status/runbook/serial code.
- Implement `RuntimeReadinessService` and pure provider wrappers.
- Keep existing `get_app_status` behavior compatible by adapting it to the shared provider only after impact and tests.

Expected focused tests:

- `tests/unit/core/readiness/runtime-readiness-service.test.ts`
- Existing agent-runbook/runtime tests touched by extraction.

### Slice 3 — Candidates, drafts, preferences

TDD first:

- Candidate resolver tests for 0/1/multiple, exact/likely/unknown, conflict, low confidence, port reordering, same VID/PID multi-device, no target inference from COM name.
- Draft tests for candidate/manual/advanced/session-create round-trip, parameter source preservation, side-effect metadata, safe missing/conflict reasons.
- Preferences tests for migration, corruption, unknown version, oversized value, unsafe fields, safe defaults.

Implementation:

- Keep candidates and drafts pure and Electron-independent.
- Preferences adapter must be isolated and versioned.

### Slice 4 — Main IPC/preload bridge

TDD first:

- Main IPC tests for `get/refresh/subscribe/unsubscribe/event`, register-before-snapshot, destroyed cleanup, send race, malformed cursor/payload, overlapping refresh latest-wins, stale event rejection, and display-safe DTO-only output.
- Preload tests for runtime parsing, listener removal, malformed payload rejection, and no `ipcRenderer`.

Impact before edits:

- `IPC_CHANNELS`
- `PreloadAPI`
- `api` / preload readiness namespace
- `registerIpcHandlers`
- `createMockPreloadAPI`

Implementation:

- Add readiness channels and namespace.
- Register readiness IPC in Main composition.
- Extend mock preload race helpers.

### Slice 5 — Renderer hydration

TDD first:

- Tests for initial loading, listener-before-subscribe ordering, pending event buffering if applicable, generation latest-wins, stale discard, refresh retry, subscribe failure, malformed event, preference diagnostics, cleanup.

Implementation:

- Renderer readiness reducer/hydration/hook uses only `window.linkterm.readiness` DTOs.
- It must not import Main/core provider types or store raw payloads.

### Slice 6 — Start Center UI

TDD first:

- Component tests for no-session empty canvas replacement, skeleton/no-device flicker prevention, primary/secondary action limits, readiness checklist states, candidate evidence/confidence, manual entry, recent suggestions, refresh, safe diagnostics copy, loading/empty/error/blocked/ready states.
- App integration tests for active session not stolen and advanced connection opening existing `ConnectionDialog`.
- i18n tests for EN/ZH keys.
- A11y tests for keyboard roles, labels, manual entry errors, status text, focus return.

Impact before edits:

- `App`
- `ConnectionDialog` if prefill is added
- i18n exports `en`/`zh`
- any renderer store/hook changed.

Implementation:

- Wire Start Center only when there is no active session.
- Keep Activity Center/AI status Phase 2 surfaces intact.
- `Observe device output` must not display Phase 4 first-signal states.

### Slice 7 — No-side-effect and performance evidence

Tests:

- Spies prove readiness refresh/render never calls session create/open, serial write, reset/flash/J-Link/RTT/GDB/install/workspace/profile mutation paths.
- Large synthetic checks/candidates/recent entries render bounded visible rows.
- Terminal-adjacent App coverage ensures existing session view remains primary and responsive.

### Slice 8 — Review and final verification

Required closeout:

- Focused changed suites after final fixes.
- `pnpm run lint`
- `pnpm run build`
- `pnpm run test`
- `pnpm run test:coverage`
- `pnpm run validate:licenses`
- `pnpm audit --prod`
- `pnpm exec openspec validate add-runtime-readiness-start-center --strict`
- `git diff --check`
- `node .gitnexus/run.cjs analyze --pdg`
- Directed GitNexus taint/PDG checks for readiness provider, IPC, preload, renderer hydration, and Start Center boundaries.
- `detect_changes({ scope: "compare", base_ref: "main" })`
- Independent requirements/UI-accessibility and code-quality/security reviews.
- Phase 3 evidence doc under `docs/engineering/phase-3-runtime-readiness-start-center-evidence.md`.

## Acceptance checklist

- [ ] No-session main canvas shows Start Center.
- [ ] Active session canvas remains terminal-first.
- [ ] Readiness distinguishes loading/checking, ready, no device, discovery failed, optional workspace/profile unavailable, blocked, and partial-result states.
- [ ] Refresh/manual entry/advanced connection are available in the correct states.
- [ ] Candidates show confidence and evidence and are never auto-submitted.
- [ ] Serial drafts preserve source, parameter source, and side-effect metadata.
- [ ] Preferences migration/corruption returns safe defaults with diagnostics.
- [ ] Renderer receives display-safe DTOs only.
- [ ] No hardware/backend side effects occur during readiness refresh/render.
- [ ] EN/ZH copy, keyboard/a11y, and bounded rendering are covered.
- [ ] Phase 3 does not claim First Success or implement Phase 4+ surfaces.

## Phase 4 handoff

Only after this phase is verified and reported may Phase 4 begin `add-serial-first-signal-flow`, which will add the monitor/status model, plan review, serial connect flow, xterm visible acknowledgement, silent/late/replay states, and focus policy.
