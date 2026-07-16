## 1. Phase 4 scope, entry, and impact gates

- [x] 1.1 Reconfirm Phase 3 evidence, current dirty worktree, absence of an existing Phase 4 implementation, and OpenSpec status before product-code implementation.
- [x] 1.2 Record fresh GitNexus upstream-impact results for every existing function, class, method, interface, or shared object selected for modification; report HIGH/CRITICAL blast radius before editing.
- [x] 1.3 Keep Phase 4 limited to Serial First Signal; do not implement Human Approval, J-Link/RTT, Pause/Take Over, durable audit, cloud/telemetry/database, generic chat UI, or hardware rollback.

## 2. Shared first-signal contracts and pure lifecycle model

- [x] 2.1 Add failing shared-schema tests for `FirstSignalObservation`, start/status/stop/subscribe requests, event payloads, strict unknown-field rejection, bounded safe diagnostics, revision monotonicity, closed reasons, and display-safe errors.
- [x] 2.2 Implement shared first-signal contracts without exposing raw transcript data beyond existing transcript rendering, raw errors/stacks, credentials, scripts, firmware/binary data, approval/lease/compensation objects, or J-Link/backend handles.
- [x] 2.3 Add failing pure lifecycle tests for start, idempotent same-key start, conflicting same-key different session, waiting, signal-detected, silent non-terminal transition, late signal, closed, errored, stopped, revision ordering, terminal retention expiry, timer cleanup, and listener cleanup.
- [x] 2.4 Implement the pure first-signal lifecycle model with attemptId/sessionId binding and stale revision rejection.

## 3. Main ObservationMonitor and session/transcript adapters

- [x] 3.1 Add failing core service tests using fake sessions/transcripts for listener-before-replay, first data before status, data before create response, replay from baseline cursor, empty data ignored, state/error/outgoing/clear ignored, silent timer keeps listening, late signal completion path, session close reasons, explicit stop, duplicate stop, runtime shutdown, and cleanup.
- [x] 3.2 After fresh impacts, implement a Main-owned `FirstSignalObservationService` or equivalent without using one-shot `waitFor` semantics that drop the listener after timeout.
- [x] 3.3 Prove ObservationMonitor does not advance or consume Renderer subscriber cursors and does not create, open, write, reset, flash, launch J-Link/RTT/GDB, or mutate workspace/profile state.

## 4. Main IPC, preload, and mock bridge

- [x] 4.1 Add failing Main IPC tests for `firstSignal:start/status/stop/subscribe/unsubscribe/event`, listener-before-status, destroyed-window cleanup, send race cleanup, malformed request/payload, revision latest-wins, duplicate start, conflicting start, idempotent stop, and display-safe DTO-only output.
- [x] 4.2 After fresh impacts, register first-signal IPC in Main composition without disturbing existing activity/readiness/session/control-profile IPC.
- [x] 4.3 Add failing preload tests for narrow `window.linkterm.firstSignal` methods, runtime parsing of invoke responses/pushed events, invalid-payload safe diagnostics, listener removal, and no exposed `ipcRenderer`.
- [x] 4.4 Extend the mock preload API fixture with deterministic first-signal start/status/event/revision/invalid-payload helpers.

## 5. Xterm visible-device acknowledgement and transcript hydration

- [x] 5.1 Add failing renderer render-event/useTranscript tests proving `lastVisibleDeviceSequence` advances only after non-empty device text receives xterm write completion/awaitable ack.
- [x] 5.2 Cover negative cases: synchronous `term.write` return alone, state/error/outgoing/clear events, empty device data, incomplete UTF-8 chunk before text exists, delayed callback after dispose/unmount, wrong session, stale attempt, and replay duplicates.
- [x] 5.3 After fresh impacts, adapt `renderEventToXterm`, `XtermLike`, `useTranscript`, and TerminalView/session hydration seams so renderer can publish visible-device ack without double rendering.
- [x] 5.4 Add tests for display-unavailable when transcript subscription/hydration fails even though Main detected data, and for replay→xterm ack→completed after subscription recovery.

## 6. Renderer first-success reducer/coordinator

- [x] 6.1 Add failing pure reducer tests for checking, needs-device, ready-to-connect, reviewing-plan, connecting, waiting-for-output, data-received, display-unavailable, silent, errored, disconnected, cancelled, and completed states.
- [x] 6.2 Cover attempt/session binding, stale event isolation, duplicate click, retry cleanup, reload retention, user/transport/session-closed reason mapping, silent→late transition, visible ack completion, and conditional focus decisions.
- [x] 6.3 Implement renderer first-success state/hydration/coordinator using only display-safe readiness, first-signal, session, and transcript-visible evidence.

## 7. Plan review, guided connect, recovery UI, and Start Center integration

- [x] 7.1 Add failing component tests for Serial plan review showing port/settings/source metadata, exclusive/port-reservation wording, no-payload-during-connect guarantee, DTR/RTS/control-line known/unknown wording, possible reset wording, and candidate changed/disappeared revalidation.
- [x] 7.2 Add failing App/Start Center integration tests proving Observe device output enters the guided serial flow, user confirm creates/opens through existing session APIs, open failure maps to errored, and active professional connection paths remain available.
- [x] 7.3 Add failing recovery tests for Keep waiting, Disconnect and edit, Back to session, Disconnect, Retry, Go to terminal, and ownsSession true/false action visibility/cleanup.
- [x] 7.4 Implement first-success UI components and wire Start Center without bypassing `SessionManager`, `WriteQueue`, `Transport`, Activity Center, or existing ConnectionDialog paths.

## 8. Optional successful connection save

- [x] 8.1 Evaluate optional save tests; defer save/skip UI coverage because the current preload profile API is save-and-open rather than a safe save-only path, so no Phase 4 save UI was implemented.
- [x] 8.2 After fresh impacts, implement save/skip only if it can use existing profile schema without schema migration or identity claims; otherwise document it as a deferred Phase 4 known limit.

## 9. Accessibility, i18n, performance, and no-side-effect evidence

- [x] 9.1 Add accessibility tests for keyboard plan review/connect/recovery, roles/names, status text not color-only, focus return, conditional terminal focus, and small-window behavior.
- [x] 9.2 Add bilingual key-coverage tests for every new Phase 4 label, status, diagnostic, action, disabled reason, plan-review message, and recovery message in `en.ts` and `zh.ts`.
- [x] 9.3 Add performance/bounded-render tests proving first-success UI and high-frequency transcript handling do not degrade terminal-adjacent rendering, input, or scrolling.
- [x] 9.4 Add no-hardware-side-effect tests/spies proving Phase 4 validation does not write serial payload during connect, reset, flash, launch J-Link/RTT/GDB, install tooling, mutate workspace/profile except explicit optional save, or execute real hardware side effects.

## 10. Review and verification

- [x] 10.1 Run focused tests after each vertical slice: shared contracts, core monitor, Main IPC/preload, transcript visible ack, renderer reducer/coordinator, UI/App integration, recovery, i18n/a11y, and affected Phase 1–3 bridge tests.
- [x] 10.2 Run lint, production build, full tests, coverage report, runtime/tooling license validation, and production dependency audit with fresh output.
- [x] 10.3 Request independent requirements/UI-accessibility and code-quality/security reviews; resolve every valid finding and rerun affected checks.
- [x] 10.4 Run verification-before-completion, OpenSpec strict validation, `git diff --check`, directed GitNexus PDG/taint checks for first-signal IPC/preload/monitor/transcript boundaries, and `detect_changes` against `main`.
- [x] 10.5 Record Phase 4 evidence, known limits, no-hardware-side-effect evidence, first-signal/visible-ack/recovery results, a11y/i18n/performance results, and explicitly request authorization before Phase 5.

## Completion notes

- Phase 4 completion may claim Serial First Signal only if non-empty device text has been xterm-completion acknowledged visible in tests and evidence.
- Phase 4 completion MUST NOT be described as A+D completion. Human Approval, J-Link/RTT, Pause/Take Over, and Durable Audit remain future phases.
