# Implementation Plan: Phase 4 `add-serial-first-signal`

Date: 2026-07-13

This plan implements only `openspec/changes/add-serial-first-signal`. Phase 0, Phase 1,
Phase 2, and Phase 3 remain unarchived and uncommitted in the current dirty worktree. Do not
commit, push, archive OpenSpec changes, or run real hardware side-effect commands.

## Phase 4 intent

Deliver the serial first-success path:

- user reviews a serial connection plan derived from `SerialConnectionDraft`;
- user explicitly connects through existing session creation/opening paths;
- Main observes first non-empty `device` transcript data using a continuous
  ObservationMonitor;
- Renderer completes first success only after the corresponding non-empty device text is
  xterm-completion acknowledged visible;
- silent, late signal, display-unavailable, errored, disconnect, retry, reload, and ownership
  recovery states are distinct and tested.

## Hard boundaries

- Do not bypass `SessionManager`, `WriteQueue`, `Transport`, `IJLinkBackend`, MCP registry,
  Activity Ledger/Center, or Main trust boundary.
- Do not implement Human Approval, `PreparedOperation`, grants, approval continuation,
  J-Link/RTT first signal, firmware download/flash/verify, Pause/Take Over, durable audit,
  cloud services, telemetry, database storage, generic chat UI, or hardware rollback.
- Do not send serial payload during connect.
- Do not reset, flash, erase, halt, start J-Link/RTT/GDB processes, install tooling, or run
  hardware-observe side effects during validation.
- Renderer may receive only display-safe first-signal DTOs; Main-only/internal objects remain
  Main-only.
- `signal visible` is not `session open` and not `data detected`; it requires xterm write
  completion/async acknowledgement for the observed non-empty device text.
- Optional profile save is not a completion precondition and must not claim stable identity.

## Expected files

New likely files:

- `src/shared/first-signal-contract.ts`
- `src/core/session/first-signal-observation/first-signal-observation-service.ts`
- `src/core/session/first-signal-observation/first-signal-state.ts`
- `src/main/ipc/first-signal-ipc.ts`
- `src/renderer/features/first-success/first-success-reducer.ts`
- `src/renderer/features/first-success/first-success-hydration.ts`
- `src/renderer/features/first-success/useFirstSuccessState.ts`
- `src/renderer/features/first-success/FirstSuccessFlow.tsx`
- `src/renderer/features/first-success/SerialPlanReview.tsx`
- `src/renderer/features/first-success/FirstSignalStatusPanel.tsx`
- Tests under `tests/unit/shared/`, `tests/unit/core/session/first-signal-observation/`,
  `tests/unit/main/ipc/`, `tests/unit/main/preload-first-signal.test.ts`,
  `tests/unit/renderer/first-success/`, `tests/unit/renderer/hooks/`, and App/TerminalView
  suites.

Existing files likely touched after impact:

- `src/shared/ipc-protocol.ts`
- `src/shared/preload-api.ts`
- `src/main/preload.ts`
- `src/main/ipc/index.ts`
- `src/main/ipc/session-ipc.ts`
- `src/renderer/lib/render-event.ts`
- `src/renderer/hooks/useTranscript.ts`
- `src/renderer/components/TerminalView.tsx`
- `src/renderer/features/readiness/StartCenter.tsx`
- `src/renderer/App.tsx`
- `src/renderer/components/ConnectionDialog.tsx` only if draft/plan handoff needs adjustment
- `src/renderer/i18n/en.ts`
- `src/renderer/i18n/zh.ts`
- `tests/fixtures/mock-preload-api.ts`

Every existing function/class/method/interface/shared object above must get fresh GitNexus
upstream impact before modification.

## Execution slices

### Slice 0 — Entry gate

1. Validate the new OpenSpec change:
   - `pnpm exec openspec validate add-serial-first-signal --strict`
2. Record current dirty worktree.
3. Reconfirm Phase 3 evidence and that user explicitly authorized Phase 4.
4. List intended existing symbols for impact.

### Slice 1 — Shared contracts and pure lifecycle

TDD first:

- Add strict schema tests for observations, requests, events, safe diagnostics, revision
  monotonicity, closed reasons, strict unknown-field rejection, and display-safe errors.
- Add pure lifecycle tests for start, idempotency, conflict, waiting, signal-detected, silent
  non-terminal, late signal, closed, errored, stopped, cleanup, retention expiry, and stale
  revision rejection.

Implementation:

- Add shared first-signal contracts.
- Add pure first-signal lifecycle/state helpers independent of Electron and React.

Expected verification:

- `pnpm exec vitest run tests/unit/shared/first-signal-contract.test.ts tests/unit/core/session/first-signal-observation`

### Slice 2 — Main ObservationMonitor

TDD first:

- Fake session/transcript tests for listener-before-replay, first data before status, data
  before create response, replay from baseline, ignored empty/state/error/outgoing/clear,
  silent→late signal, close reasons, explicit stop, duplicate stop, runtime shutdown, and
  cleanup.

Impact before edits:

- `SessionManager`
- `registerSessionIpc`
- `onSessionEvent`
- `onSessionDestroyed`
- any transcript/session adapter functions touched.

Implementation:

- Add Main-owned observation service with injected adapters.
- Do not use one-shot timeout semantics that remove the listener; if any existing wait path is
  reused, it must re-arm immediately after timeout.
- Do not advance renderer subscriber cursors.

### Slice 3 — Main IPC/preload/mock bridge

TDD first:

- Main IPC tests for start/status/stop/subscribe/unsubscribe/event, destroyed cleanup,
  send-race cleanup, malformed payload, duplicate/conflicting start, idempotent stop,
  revisions, and display-safe DTO output.
- Preload tests for runtime parsing, invalid event diagnostics, listener removal, and no
  `ipcRenderer`.

Impact before edits:

- `IPC_CHANNELS`
- `PreloadAPI`
- `api`
- `registerIpcHandlers`
- `createMockPreloadAPI`

Implementation:

- Add first-signal channels/namespace.
- Register IPC in composition root.
- Extend test fixture helpers.

### Slice 4 — Xterm visible acknowledgement

TDD first:

- Render/useTranscript tests proving completion only after non-empty device text receives
  xterm completion/awaitable ack.
- Negative tests for sync write return, state/error/outgoing/clear, empty data,
  incomplete UTF-8 before decoded text, delayed callback after dispose/unmount, wrong
  session, stale attempt, and replay duplicates.

Impact before edits:

- `renderEventToXterm`
- `XtermLike.write`
- `useTranscript`
- `TerminalView`
- session hydration/subscription hooks if touched.

Implementation:

- Make render-event/useTranscript expose `lastVisibleDeviceSequence` or equivalent
  first-success visible ack.
- Preserve existing terminal rendering and no duplicate output.

### Slice 5 — Renderer first-success coordinator

TDD first:

- Pure reducer tests for all first-success phases and recovery transitions.
- Attempt/session binding tests for stale events, duplicate click, retry cleanup, reload,
  reason mapping, silent→late, visible ack completion, display-unavailable, and focus policy.

Implementation:

- Add renderer-local first-success reducer/hydration/hook.
- Consume readiness, session, first-signal, and transcript-visible evidence only through
  display-safe DTOs and existing renderer session state.

### Slice 6 — Plan review and guided connect UI

TDD first:

- Component tests for plan review fields and side-effect wording.
- App/Start Center integration tests for observe intent → guided flow → explicit connect.
- Open failure, candidate changed/disappeared, and advanced connection escape tests.

Impact before edits:

- `StartCenter`
- `App`
- `ConnectionDialog` if prefill/return flow changes
- i18n exports `en`/`zh`
- app store/dialog prefill if touched.

Implementation:

- Add first-success UI components.
- Wire Start Center observe intent into guided serial flow.
- Connect only through existing session APIs after explicit user confirmation.

### Slice 7 — Recovery, focus, optional save

TDD first:

- Tests for Keep waiting, Disconnect and edit, Back to session, Disconnect, Retry, Go to
  terminal, ownsSession true/false visibility and cleanup.
- Focus tests for current flow/no modal vs Activity Center/advanced dialog/input/other
  session.
- Optional save tests: save offered only after completed, skip keeps completion, failure does
  not roll back, saved data uses existing schema and avoids identity claims.

Implementation:

- Add idempotent recovery handlers.
- Add focus policy.
- Implement optional save only if existing profile schema suffices; otherwise record known
  limit.

### Slice 8 — Accessibility, i18n, performance, no-side-effect evidence

Tests:

- EN/ZH key coverage.
- Keyboard/a11y/status roles/focus return/small window/reduced motion.
- High-frequency transcript/first-success UI does not degrade terminal-adjacent rendering.
- Spies prove no serial payload write, reset, flash, J-Link/RTT/GDB launch, install,
  workspace/profile mutation except explicit optional save, or real hardware action.

### Slice 9 — Review and final verification

Required closeout:

- Focused changed suites after final fixes.
- `pnpm run lint`
- `pnpm run build`
- `pnpm run test`
- `pnpm run test:coverage`
- `pnpm run validate:licenses`
- `pnpm audit --prod`
- `pnpm exec openspec validate add-serial-first-signal --strict`
- `git diff --check`
- `node .gitnexus/run.cjs analyze --pdg`
- Directed GitNexus taint/PDG checks for first-signal monitor, IPC, preload, transcript
  rendering, renderer hydration, and Start Center boundaries.
- `detect_changes({ scope: "compare", base_ref: "main" })`
- Independent requirements/UI-accessibility and code-quality/security reviews.
- Phase 4 evidence doc under `docs/engineering/phase-4-serial-first-signal-evidence.md`.

## Acceptance checklist

- [ ] User can start from Start Center, choose/manual-enter a serial device, review plan,
      connect, and complete only after first non-empty device text is xterm-acknowledged
      visible.
- [ ] Session open, waiting, silent, signal-detected, display-unavailable, visible, errored,
      user-disconnected, transport-disconnected, and cancelled states are distinct.
- [ ] Silent is non-terminal and late signal can complete the same attempt.
- [ ] FirstSignal start/status/event/stop use attemptId/revision, are idempotent, survive
      renderer reload within retention, and clean up listeners/timers.
- [ ] ObservationMonitor does not advance renderer transcript subscriber cursor.
- [ ] Data before create response/status/Terminal mount is detected and rendered exactly once.
- [ ] `lastVisibleDeviceSequence` advances only after non-empty device text xterm
      completion/async ack; state/error/partial UTF-8/delayed callback/dispose do not
      complete.
- [ ] Display-unavailable can recover via replay and complete only after visible ack.
- [ ] Recovery actions obey ownsSession rules and clean monitor/session/port idempotently.
- [ ] Late signal does not steal focus from other surfaces.
- [ ] Optional save is after completion, optional, existing-schema-only, and not identity
      verification.
- [ ] EN/ZH, keyboard, screen-reader, reduced-motion, small-window, and performance evidence
      exists.
- [ ] Phase 4 introduces no Phase 5+ surfaces and no real hardware side effects in
      validation.

## Phase 5 handoff

Only after Phase 4 is verified and reported may Phase 5 begin Human Approval Broker. Phase 4
must not treat `confirm=true`, a button click, or a first-signal success as human approval for
future approval-required operations.
