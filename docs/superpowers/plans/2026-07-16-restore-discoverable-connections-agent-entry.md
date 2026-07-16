# LinkTerm saved-first single-entry connection plan

## Step 1 — Characterization tests

- Files: `tests/unit/renderer/readiness/start-center-components.test.tsx`, `tests/unit/renderer/readiness/readiness-i18n.test.ts`, `tests/unit/renderer/App.start-center.test.tsx`.
- Change: lock the saved-first order, one Manual open entry, no COM list on Start Center, and lazy readiness.
- Expected failure: old Start Center still renders a readiness scan on mount or exposes serial-specific actions.
- Verification: `pnpm exec vitest run ...`.

## Step 2 — App saved-connection boundary

- Files: `src/renderer/App.tsx`, `tests/unit/renderer/App.start-center.test.tsx`.
- Symbols: `App`, saved-connection loader/open callback.
- Change: call existing `api.connections.list`, pass summaries to Start Center, and open via existing `api.connections.open` then update the App session store.
- Guard: failures remain local UI errors; no transport write or readiness side effect.
- Verification: focused App tests and `pnpm exec tsc -b --pretty false`.

## Step 3 — Start Center presentation

- Files: `src/renderer/features/readiness/StartCenter.tsx`, `tests/unit/renderer/readiness/start-center-components.test.tsx`, `src/renderer/i18n/en.ts`, `src/renderer/i18n/zh.ts`.
- Symbols: `StartCenter`, new saved-profile presentation helper.
- Change: render saved summaries before the single Manual open action; keep all connection types in ConnectionDialog; keep advanced facts collapsed and omit serial candidates from it.
- Verification: focused renderer tests, lint, and build.

## Step 4 — Lazy discovery boundary

- Files: `src/renderer/App.tsx`, `src/renderer/features/readiness/useRuntimeReadinessState.ts`, `src/renderer/features/readiness/StartCenter.tsx`.
- Symbols: `App`, `useRuntimeReadinessState`, `StartCenter`.
- Change: do not subscribe to runtime readiness (and therefore do not scan ports) during ordinary home-page startup. Start it only after the Advanced devices disclosure is opened. The Manual open action mounts `ConnectionDialog`, whose existing `SerialPortPicker` discovers ports inside the connection flow.
- Verification: assert no readiness subscription or serial list call before either disclosure or Manual open; assert discovery after Manual open.

## Step 5 — Handoff

- Run OpenSpec strict validation, full `pnpm ci:check`, `git diff --check`, GitNexus `detect_changes --scope all`, and update `docs/engineering/clear-start-center-evidence.md`.
- Confirm no files outside the intended renderer/spec/test/docs scope were changed by this fix; do not commit or touch hardware.
