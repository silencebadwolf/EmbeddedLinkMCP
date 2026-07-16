# Phase 2 Implementation Plan: add-ai-activity-center

Date: 2026-07-13

This plan implements only `openspec/changes/add-ai-activity-center`. It assumes Phase 0 and Phase 1 remain unarchived and uncommitted in the current dirty worktree. It must not enter Phase 3 or implement Readiness, First Signal, Human Approval, Pause/Take Over, durable audit, telemetry, cloud services, databases, or real hardware side effects.

## Inputs

- A+D spec package: `docs/superpowers/specs/2026-07-11-linkterm-first-success-ai-trust`
- Phase 1 evidence: `docs/engineering/phase-1-operation-ledger-evidence.md`
- Phase 2 OpenSpec: `openspec/changes/add-ai-activity-center`
- Existing renderer seams:
  - `src/renderer/App.tsx`
  - `src/renderer/components/OriginIndicator.tsx`
  - `src/renderer/components/SessionTabBar.tsx`
  - `src/renderer/store/app-store.ts`
  - `src/renderer/i18n/en.ts`
  - `src/renderer/i18n/zh.ts`
  - `tests/fixtures/mock-preload-api.ts`

## Invariants

- Renderer consumes only `window.linkterm.activity` display-safe DTOs.
- No raw evidence, raw terminal transcript, raw scripts, credentials, tokens, binary/firmware payloads, raw paths beyond approved display aliases, Main-only approval objects, backend handles, or internal policy fields enter React state.
- Activity Center is read-only: it does not change authorization, grant, pause, readiness, session creation, flash/reset/erase, or hardware behavior.
- Every product-code edit requires fresh GitNexus upstream impact first; HIGH/CRITICAL results are reported before editing.
- TDD is mandatory: each behavior slice starts with failing tests, then the smallest implementation.
- No commit, push, PR, OpenSpec archive, or real hardware operation without explicit user authorization.

## Expected files

New files are expected under an isolated renderer activity feature, for example:

- `src/renderer/features/activity/activity-reducer.ts`
- `src/renderer/features/activity/activity-selectors.ts`
- `src/renderer/features/activity/use-activity-center.ts`
- `src/renderer/features/activity/AiStatusCapsule.tsx`
- `src/renderer/features/activity/ActivityCenterDrawer.tsx`
- `tests/unit/renderer/activity/*.test.ts(x)`

Existing likely edit targets:

- `src/renderer/App.tsx`
- `src/renderer/components/OriginIndicator.tsx`
- `src/renderer/components/SessionTabBar.tsx`
- `src/renderer/store/app-store.ts`
- `src/renderer/i18n/en.ts`
- `src/renderer/i18n/zh.ts`
- `tests/fixtures/mock-preload-api.ts`

## Task 1 — Start gate and impacts

1. Re-read `AGENTS.md`, `.gitnexusrc`, Phase 2 OpenSpec, and this plan.
2. Run `git status --short` and record the existing dirty worktree caveat.
3. Run `pnpm exec openspec validate add-ai-activity-center --strict`.
4. Before editing existing symbols, run upstream impact for:
   - `App`
   - `OriginIndicator`
   - `SessionTabBar`
   - `useAppStore`
   - `createMockPreloadAPI`
   - i18n translation exports if they are edited
5. Report any HIGH/CRITICAL risk before edits.

## Task 2 — Pure reducer and selectors

RED tests:

- strict display-safe event input only;
- no unknown/raw-field retention;
- runtime reset and truncation handling;
- duplicate event id/sequence handling;
- sequence gap state;
- operation and call summary derivation;
- workflow milestone/step derivation;
- terminal vs active/attention grouping;
- read-only burst folding without losing queryability;
- filters by actor/risk/phase/action/session/workspace/target/search;
- large input selector returns a bounded visible slice.

Implementation:

- Add pure reducer/selectors without React or subscriptions.
- Store only serializable display state.
- Derive group ids from safe DTOs; never treat derived ids as authority.

Verification:

```powershell
pnpm exec vitest run tests/unit/renderer/activity/activity-reducer.test.ts
```

## Task 3 — Hydration controller/hook

RED tests:

- listener registered before `activity.subscribe`;
- pending pushed events buffered during subscription;
- returned snapshot replaces retained state at cursor C;
- buffered events at/below C discarded;
- newer contiguous events applied once;
- gap triggers snapshot/resync diagnostic;
- runtime mismatch/truncation/reset reflected safely;
- malformed preload result does not mutate retained state;
- unmount calls local listener cleanup and Main unsubscribe;
- renderer reload hydrates from prior cursor where available.

Implementation:

- Add a hook/controller around `window.linkterm.activity`.
- Extend mock preload fixture with deterministic subscribe/snapshot/event race helpers.
- Keep subscription cleanup outside Zustand persistent state.

Verification:

```powershell
pnpm exec vitest run tests/unit/renderer/activity/use-activity-center.test.ts tests/unit/main/preload-activity.test.ts
```

## Task 4 — Status capsule and drawer

RED tests:

- capsule priority: pending/attention/running/idle;
- read-only bursts do not flicker top status;
- drawer opens/closes from capsule;
- active/attention default tab;
- history and filters;
- empty/loading/error states;
- workflow steps render under operation;
- detail expansion excludes raw/unknown fields;
- bounded/virtualized row rendering for large retained histories.

Implementation:

- Add `AiStatusCapsule`.
- Add `ActivityCenterDrawer`.
- Wire them into `App` only after impact report.
- Keep drawer overlay behavior so terminal width is not permanently compressed.

Verification:

```powershell
pnpm exec vitest run tests/unit/renderer/activity/AiStatusCapsule.test.tsx tests/unit/renderer/activity/ActivityCenterDrawer.test.tsx
```

## Task 5 — OriginIndicator entry and context actions

RED tests:

- existing origin-dot opacity behavior remains compatible;
- accessible name describes AI/Human/System activity;
- session origin entry opens drawer filtered to the session;
- `Go to session` focuses only existing session;
- `Diagnose` disabled state has reason and no side effect when unsupported;
- `Copy summary` produces bounded redacted text only;
- AI-created session does not steal focus by default; any `Follow AI` state is explicit and renderer-local.

Implementation:

- Extend `OriginIndicator` with button/entry mode or wrap it in `SessionTabBar`.
- Implement context action availability and handlers in renderer-only code.
- Use existing session store actions for focus; no new backend operations.

Verification:

```powershell
pnpm exec vitest run tests/unit/renderer/components/OriginIndicator.test.tsx tests/unit/renderer/activity/activity-actions.test.tsx
```

## Task 6 — i18n, a11y, performance, integration

RED tests:

- all new keys exist in English and Chinese;
- keyboard open/close, Escape, focus placement/return;
- reduced-motion state does not rely on animation;
- large list does not render every event row;
- terminal-adjacent rendering remains responsive in a synthetic test.

Implementation:

- Add i18n keys to `en.ts` and `zh.ts`.
- Add ARIA labels/roles and keyboard handlers.
- Add bounded visible rows or local virtualization without new dependency unless explicitly justified.

Verification:

```powershell
pnpm exec vitest run tests/unit/renderer/activity tests/unit/renderer/components
```

## Task 7 — Review and final gates

1. Run focused Phase 2 tests and Phase 1 activity bridge tests:

```powershell
pnpm exec vitest run tests/unit/shared/activity-contract.test.ts tests/unit/main/preload-activity.test.ts tests/unit/main/ipc/activity-ipc.test.ts tests/integration/operation-ledger-mcp.test.ts tests/unit/renderer/activity
```

2. Run authoritative gates:

```powershell
pnpm run lint
pnpm run build
pnpm run test
pnpm run test:coverage
pnpm run validate:licenses
pnpm audit --prod
pnpm exec openspec validate add-ai-activity-center --strict
git diff --check
```

3. Request independent requirements/UI-a11y review and code-quality/security review.
4. Refresh GitNexus PDG/taint:

```powershell
node .gitnexus/run.cjs analyze --pdg
```

5. Run directed GitNexus checks for edited renderer/preload boundaries and `detect_changes({ scope: "compare", base_ref: "main" })`.
6. Record Phase 2 evidence and known limits.
7. Report Phase 2 only and request authorization before Phase 3.

## Done for Phase 2

- Activity Center is visible and queryable for retained Phase 1 activity.
- Default view highlights active/attention/task groups and folds ordinary read-only bursts.
- Snapshot/event hydration is race-safe and reload-safe.
- Workflow steps render when present.
- OriginIndicator can open a filtered Activity Center.
- `Go to session`, `Diagnose`, and `Copy summary` exist with safe disabled/available behavior.
- UI is bilingual, accessible, and bounded for large retained histories.
- Full local gates, review feedback, OpenSpec validation, GitNexus checks, and no-hardware-side-effect evidence are fresh.

This does not complete A+D overall.
