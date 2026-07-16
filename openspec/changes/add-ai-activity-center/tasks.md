## 1. Phase 2 scope, impact, and contracts

- [x] 1.1 Reconfirm the current worktree, Phase 1 activity bridge evidence, OpenSpec status, and absence of an existing Phase 2 change immediately before implementation.
- [x] 1.2 Record fresh GitNexus upstream-impact results for every existing renderer/preload/mock symbol selected for modification; report HIGH/CRITICAL blast radius before editing.
- [x] 1.3 Add failing reducer/selector contract tests for strict display-safe input, event ordering, runtime reset, duplicate/gap handling, terminal/non-terminal operation summaries, workflow steps, health diagnostics, and no unknown/raw-field retention.
- [x] 1.4 Implement the isolated renderer activity reducer/view model until the contract tests pass without React, DOM, subscriptions, or Main-only objects.

## 2. Hydration and store integration

- [x] 2.1 Add failing hook/store tests proving listener-before-subscribe ordering, pending-event buffering, snapshot cut replacement, discard-at-or-below-cursor, contiguous application, gap-triggered resnapshot, malformed preload result handling, unsubscribe cleanup, and renderer reload hydration.
- [x] 2.2 Implement the activity hydration controller/hook and minimal renderer store integration using only `window.linkterm.activity` display-safe DTOs.
- [x] 2.3 Extend the mock preload API fixture with deterministic activity subscribe/snapshot/event race helpers and no exposed `ipcRenderer`.

## 3. AI status capsule and drawer UI

- [x] 3.1 Add failing component tests for capsule priority, non-flickering read-only bursts, drawer open/close, active/attention default mode, history mode, filters, empty/loading/error states, reduced-motion behavior, and keyboard/Escape focus handling.
- [x] 3.2 Implement `AiStatusCapsule` and `ActivityCenterDrawer` with bounded/virtualized visible rows, safe operation/call/detail rendering, workflow steps, and English/Chinese strings.
- [x] 3.3 Add tests and implementation proving ordinary retained operations/calls remain queryable through filters/details even when read-only bursts are folded out of the default top-level list.

## 4. Session entry and context actions

- [x] 4.1 After fresh impacts, upgrade `OriginIndicator`/session tab integration with an accessible Activity Center session-filter entry while preserving the existing origin-dot behavior.
- [x] 4.2 Add failing tests for `Go to session`, `Diagnose`, and `Copy summary` availability/disabled reasons, safe redacted copied text, and no hardware/backend side effects.
- [x] 4.3 Implement the three context actions using existing renderer/session/preload capabilities only; unavailable actions must explain why.
- [x] 4.4 Add failing tests and implementation for AI-created session non-stealing behavior plus any opt-in `Follow AI` renderer state.

## 5. Performance, accessibility, and i18n

- [x] 5.1 Add large-list and retained-state cap tests showing grouped retained operations render bounded visible rows, renderer-local retained events/operations are capped with truncation diagnostics, and App-level terminal-adjacent rendering remains covered.
- [x] 5.2 Add accessibility tests for names, roles, focus loop/escape close, screen-reader distinct status text, and keyboard access from capsule/session origin entry.
- [x] 5.3 Add bilingual UI copy for every new label, status, disabled reason, filter, action, and error state; tests must fail on missing English/Chinese keys.

## 6. Review and verification

- [x] 6.1 Run focused reducer, hook, component, preload-mock, renderer, and Phase 1 activity bridge tests after each vertical slice.
- [x] 6.2 Run lint, production build, full tests, coverage report, runtime/tooling license validation, and production dependency audit with fresh output.
- [x] 6.3 Request independent requirements/UI-accessibility and code-quality/security reviews; resolve every valid finding and rerun affected checks.
- [x] 6.4 Run verification-before-completion, OpenSpec strict validation, `git diff --check`, directed GitNexus PDG/taint checks for renderer/preload activity boundaries, and `detect_changes` against `main`.
- [x] 6.5 Record Phase 2 evidence, known limits, performance/a11y/i18n results, no-hardware-side-effect evidence, and explicitly request authorization before Phase 3.

## Completion notes

- `Follow AI` is not exposed in Phase 2, so no renderer-local follow state was introduced. The required AI-created session non-stealing behavior is locked by store regression coverage.
- The 6.x verification tasks were checked only after fresh closeout commands, independent review findings resolution, GitNexus checks, and Phase 2 evidence capture.
