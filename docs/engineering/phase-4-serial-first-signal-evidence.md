# Phase 4 Evidence: add-serial-first-signal

Date: 2026-07-13

Status: Phase 4 Serial First Signal implementation, review disposition, and local
verification evidence are captured. This document covers Phase 4 only. It does not claim
Human Approval, J-Link/RTT first signal, Pause/Take Over, Durable Audit, or the overall
A+D goal is complete.

## Scope delivered

Phase 4 implements the guided serial first-success path:

- Strict shared `FirstSignalObservation` contracts and display-safe first-signal IPC DTOs.
- Main-owned first-signal observation service with attempt/session binding, baseline replay,
  silent non-terminal timeout, close/error/stop/shutdown cleanup, and no Renderer transcript
  cursor consumption.
- Main IPC, preload namespace, and mock preload helpers for
  `firstSignal.start/status/stop/subscribe/unsubscribe/event`.
- Renderer xterm visible-device acknowledgement:
  first success completes only after non-empty `device` text is decoded and xterm write
  completion callback acknowledges visibility.
- Renderer first-success reducer/coordinator with distinct checking, reviewing, connecting,
  waiting, data-received, display-unavailable, silent, errored, disconnected, cancelled, and
  completed states.
- Start Center integration:
  manual/candidate serial paths enter guided plan review; only explicit `Confirm connect`
  creates an existing serial session and starts the first-signal monitor.
- Plan review displays port/settings/source, exclusive port reservation, no-payload
  guarantee, DTR/RTS known/unknown wording, and possible reset wording.
- Candidate revalidation blocks stale live candidate evidence before session creation.
- Candidate conflict detection fingerprints display-safe candidate evidence, so changed
  confidence/evidence cannot silently reuse a stale draft with the same serial settings.
- Recovery actions include Keep waiting, Disconnect and edit, Back to session, Disconnect,
  Retry, and Go to terminal with `ownsSession`-specific visibility/cleanup.
- Retry of an owned first-success session stops the old observation and releases the old
  session before creating the replacement session.
- English and Chinese first-success UI copy, status text, actions, and diagnostics.

Explicitly out of scope for Phase 4:

- Human Approval Broker, `PreparedOperation`, grants, approval continuation,
  `AuthorizationRecord`, `CallerPrincipalId`, `Lease`, or `CompensationCandidate`.
- J-Link/RTT first signal, GDB launch, reset, flash, firmware download/verify, or hardware
  rollback promises.
- Pause / Take Over.
- Durable JSONL audit/export/clear.
- Cloud services, databases, default telemetry, remote approval, or generic chat UI.
- Real hardware side effects.

## First-success completion evidence

Automated tests prove:

- Main observation alone, session open, and synchronous `term.write` return do not complete
  first success.
- Empty device data, state/error/outgoing/clear events, incomplete UTF-8 chunks before text
  exists, wrong session, stale attempt, replay duplicates, and delayed callbacks after
  unmount/dispose do not complete first success.
- Non-empty `device` text completes only after xterm write completion callback resolves for
  the matching attempt/session/sequence.
- Display-unavailable can recover through replay and then complete after xterm ack.
- Silent is non-terminal; Keep waiting keeps the monitor alive.
- Activity Center visibility suppresses first-success terminal auto-focus even when a valid
  visible-device ack completes.

## Display-safe and trust-boundary evidence

- Renderer only receives strict `FirstSignalObservation` DTOs and first-success UI state.
- Preload parses first-signal invoke responses and pushed events before invoking Renderer
  handlers. Malformed pushed events produce bounded `{ code: "firstSignal.invalid_payload",
  severity: "error" }` diagnostics and do not expose raw payloads.
- Main IPC parses first-signal requests and emits schema-validated events.
- Observation service reads transcript events from Main-owned sessions and does not expose raw
  transcript bytes to Renderer outside the existing terminal rendering path.
- First-success coordinator binds `attemptId + sessionId`; stale events and stale xterm
  callbacks are ignored.
- Guided connect calls existing `session.create` only after human confirmation, then
  `firstSignal.start`; tests prove it does not call `session.write`, RTT/J-Link/flash,
  saved-connection save/open/delete, or control-profile download/chip paths.
- Candidate drafts are revalidated against a fresh readiness snapshot before confirm. Missing
  candidates, serial-setting conflicts, and evidence/confidence fingerprint changes fail
  closed before `session.create`.

## TDD evidence

Representative red-green slices:

- Shared contracts + lifecycle:
  `tests/unit/shared/first-signal-contract.test.ts` and
  `tests/unit/core/session/first-signal-observation`.
- Main IPC/preload/mock bridge:
  `tests/unit/main/ipc/first-signal-ipc.test.ts`,
  `tests/unit/main/preload-first-signal.test.ts`, and
  `tests/unit/fixtures/mock-preload-api-first-signal.test.ts`.
- Xterm visible ack:
  `tests/unit/renderer/lib/render-event.test.ts` and
  `tests/unit/renderer/hooks/useTranscript.test.ts`.
- Renderer reducer/coordinator:
  `tests/unit/renderer/first-success/first-success-reducer.test.ts`,
  `tests/unit/renderer/first-success/FirstSuccessFlow.test.tsx`,
  `tests/unit/renderer/first-success/first-success-i18n.test.ts`, and
  `tests/unit/renderer/App.start-center.test.tsx`.
- No-side-effect evidence:
  `tests/unit/renderer/readiness/start-center-no-side-effects.test.tsx` plus guided connect
  assertions in `tests/unit/renderer/App.start-center.test.tsx`.

## GitNexus impact evidence

Fresh upstream impact was run before modifying existing product symbols during Phase 4.
Notable results:

- `PreloadAPI`: CRITICAL; reported before continuing. Implementation remained additive via a
  narrow `firstSignal` namespace and runtime parsing tests.
- `IPC_CHANNELS`: LOW before adding first-signal channel names.
- `registerIpcHandlers` / `MainProcessContext`: LOW before composition-root first-signal
  service registration.
- `api` in `src/main/preload.ts`: LOW before preload first-signal namespace edits.
- `renderEventToXterm`, `XtermLike`, `useTranscript`: LOW before xterm visible ack changes.
- `TerminalView`: LOW before adding optional visible-device callback prop.
- `StartCenter`, `App`, `en`, `zh`: LOW before guided flow/i18n integration.
- `registerIpcHandlers` and preload `api` were rechecked as LOW before build-error type
  fixes.
- Review follow-up impact checks were also recorded for `confirmFirstSuccessConnect` (LOW),
  `retryFirstSignal` (LOW), `useTranscript` (LOW), `TerminalView` (LOW), `App` (LOW),
  `SerialConnectionDraftSchema` (LOW), `createDraftFromCandidate` (LOW),
  `isDraftCandidateStale` (LOW), and `handleVisibleDeviceSequence` (LOW).
- `destroyFirstSuccessSession` returned HIGH during review follow-up and was reported before
  proceeding. The helper body was not modified; the LOW-risk `retryFirstSignal` path only
  calls the existing helper to release an owned retry session.

## Fresh validation evidence

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/shared/first-signal-contract.test.ts tests/unit/core/session/first-signal-observation tests/unit/core/readiness/serial-connection-draft.test.ts tests/unit/main/ipc/first-signal-ipc.test.ts tests/unit/main/preload-first-signal.test.ts tests/unit/fixtures/mock-preload-api-first-signal.test.ts tests/unit/main/ipc/index.test.ts tests/unit/renderer/lib/render-event.test.ts tests/unit/renderer/hooks/useTranscript.test.ts tests/unit/renderer/first-success tests/unit/renderer/readiness/start-center-components.test.tsx tests/unit/renderer/readiness/start-center-no-side-effects.test.tsx tests/unit/renderer/readiness/readiness-i18n.test.ts tests/unit/renderer/App.start-center.test.tsx tests/unit/renderer/App.first-success-focus-policy.test.tsx` | PASS: 18 files / 121 tests |
| `pnpm run lint` | PASS |
| `pnpm run build` | PASS, with Vite chunk-size warning |
| `pnpm run test` | PASS: 152 files / 1838 tests |
| `pnpm run test:coverage` | PASS: 152 files / 1838 tests; statements 81.88%, branches 73.63%, functions 83.73%, lines 84.40% |
| `pnpm run validate:licenses` | PASS: 19 runtime dependencies and 29 packages in 1 audited dev-tooling production closure |
| `pnpm audit --prod` | PASS: no known vulnerabilities |
| `pnpm exec openspec validate add-serial-first-signal --strict` | PASS |
| `git diff --check -- openspec/changes/add-serial-first-signal docs/superpowers/plans/2026-07-13-add-serial-first-signal.md src/core/session/first-signal-observation src/main/ipc src/main/preload.ts src/renderer src/shared tests` | PASS, LF→CRLF warnings only |

## Accessibility, i18n, performance, and no-side-effect evidence

- `FirstSuccessFlow` exposes a role=status text state; status is not color-only.
- Plan review and recovery controls are named buttons and keyboard-focusable.
- First-success i18n coverage asserts every `firstSuccess.*` key is present and non-empty in
  English and Chinese, grouped by labels, statuses, diagnostics, actions, and plan-review
  messages.
- Reducer repeated-observation tests prove high-frequency repeated observation updates keep
  `phaseHistory` bounded to actual phase changes.
- Guided connect tests assert no serial payload write, no RTT/J-Link path, no flash/download,
  no saved-connection save/open/delete, and no control-profile chip/download side effects.
- Candidate disappearance/conflict before connect blocks session creation and first-signal
  monitor start.

## GitNexus PDG / taint / detect_changes evidence

Latest GitNexus refresh:

- `node .gitnexus/run.cjs analyze --pdg`
- PASS: 35,531 nodes / 65,421 edges / 528 clusters / 300 flows.

Whole-repo GitNexus taint explain returned 0 findings. Directed Phase 4 boundary review
included:

- `src/main/ipc/first-signal-ipc.ts`
- `src/main/preload.ts`
- `src/core/session/first-signal-observation/first-signal-observation-service.ts`
- `src/shared/first-signal-contract.ts`
- `src/shared/serial-connection-draft.ts`
- `src/renderer/hooks/useTranscript.ts`
- `src/renderer/lib/render-event.ts`
- `src/renderer/App.tsx`

Caveat: GitNexus taint 0 findings is not proof of safety. GitNexus notes that
closure/callback, property/field, implicit/control-dependence, and some sanitizer patterns
are not fully modeled.

Directed PDG checks:

- `src/main/ipc/first-signal-ipc.ts`: key guards include schema invalid request safe
  failure, subscribe cleanup, destroyed sender cleanup, and attemptId filtering before event
  send.
- `confirmFirstSuccessConnect`: controls 27. Key guards include preload unavailable, fresh
  readiness failure, candidate stale/fingerprint mismatch, missing serial port,
  `session.create` failure, `firstSignal.start` failure, and success-only subscribe.
- `isDraftCandidateStale`: controls 11. Key guards include candidate missing, serial missing,
  fingerprint mismatch, and conflicting evidence before connect.
- `renderEventToXterm`: controls 27. Visible ack is gated by decoded non-empty `device`
  text, non-empty output, and xterm write callback; state/error/clear/empty return no-ack.
- `handleVisibleDeviceSequence`: guards include attemptId/session binding and
  `canAutoFocusFirstSuccessTerminal`.
- `useTranscript`: guards include display-unavailable/recovered, null session/terminal, no
  API, duplicate sequence dedupe, cancelled callback guard, destroyed envelope cleanup, and
  visible ack only when completion carries a sequence.
- `first-signal-observation-service.ts`: guards include invalid start/status/stop, missing
  session, missing attempt, conflicting clientAttemptKey, attach-before-replay,
  timeout→silent, stop/shutdown detach cleanup, and closed/errored mapping.
- `fingerprintDeviceCandidate`: loop-only data normalization over display-safe candidate
  fields.

`detect_changes({ scope: "compare", base_ref: "main" })` result:

- CRITICAL: 48 indexed changed files / 294 changed indexed symbols / 57 affected processes.
- This reflects the cumulative dirty Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4
  worktree, not a Phase 4-only isolated diff.
- Expected Phase 4 processes appear in the result, including App first-success,
  retry first signal, visible-device sequence handling, openManual/openCandidate serial flow,
  disconnect/recovery, display-unavailable/recovered, candidate fingerprint/revalidation,
  useTranscript, TerminalView, renderEventToXterm, and first-signal IPC/preload.
- Because no phase commits exist yet and several files carry cumulative cross-phase edits,
  this `detect_changes` result is useful as a regression scope warning, not as a clean
  Phase 4-only proof.

## Optional successful connection save

Phase 4 does not implement optional save after first success. The current preload connection
profile API exposes `connections.saveAndOpen`, `open`, `delete`, and `list`, but not a safe
save-only API. Calling `saveAndOpen` after first success would open another session and would
change behavior beyond the Phase 4 no-extra-side-effect boundary.

This is recorded as a deferred Phase 4 known limit under the OpenSpec allowance that saving
MAY be offered only if it can use an existing schema/path without redefining completion.
The OpenSpec keyboard scenario was clarified so save/skip controls are required only when the
optional save-after-success offer is present.

## Independent review evidence

Independent Phase 4 reviews requested:

- Requirements/UI/accessibility review: completed with no Critical findings and two
  Important findings.
  - Candidate revalidation conflict/evidence drift: fixed by fresh readiness revalidation
    plus candidate fingerprint comparison before `session.create`.
  - Focus policy concern: current implementation already gates terminal auto-focus through
    `canAutoFocusFirstSuccessTerminal`; regression coverage was added to prove Activity
    Center visibility suppresses focus.
- Code-quality/security review: independent review agents did not return a usable result
  before timeout and were interrupted rather than waited on indefinitely. Phase 4 therefore
  used a local code/security checklist plus directed GitNexus PDG/taint fallback. No
  Critical/Important fallback findings remain open. GitNexus 0 taint findings are recorded
  as supporting evidence, not a safety proof.

## Known warnings and limits

- Worktree remains intentionally dirty with Phase 0–4 uncommitted changes. Do not reset or
  clean it.
- `detect_changes(compare main)` is CRITICAL because all phases are uncommitted in one
  worktree. This limitation is recorded rather than hidden.
- GitNexus `analyze --pdg` succeeds but emits a Node `[DEP0190]` deprecation warning about
  child-process shell argument handling in the runner.
- Vite warns about chunks larger than 500 KiB during production build; this is not currently
  configured as a failure.
- `git diff --check` emits LF→CRLF normalization warnings on Windows and exits 0.
- No real hardware side-effect validation was performed.
- Optional save after success is deferred because the available saved-connection preload API
  is save-and-open, not save-only.

## Closeout status

Phase 4 Serial First Signal is closed for the Serial First Signal scope only. The next phase
still requires explicit user authorization before Phase 5 Human Approval begins.
