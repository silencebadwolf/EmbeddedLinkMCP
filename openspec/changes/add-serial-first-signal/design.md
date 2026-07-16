# Design: Phase 4 Serial First Signal

## Goals

- Complete the first A-side happy path: choose/review a serial draft, connect, observe the
  first non-empty device text, and complete only after that text is visibly acknowledged by
  xterm.
- Distinguish `session open`, `open but silent`, `data detected`, `data received but not
  visible`, `signal visible`, `subscribe failed`, `transport errored`, and explicit user
  disconnect/cancel.
- Keep silent as a non-terminal state. The monitor continues after timeout and late device
  output can still complete the same attempt.
- Keep the monitor Main-owned and revisioned so Renderer reload/status-event races do not
  lose or duplicate state.
- Preserve existing advanced/professional session flows and avoid bypassing SessionManager,
  WriteQueue, Transport, or Main trust boundaries.

## Non-goals

- Human approval, grants, prepared operations, or approval continuation.
- J-Link/RTT-specific first signal, firmware download/flash/verify, GDB server launch, reset,
  halt, erase, or any high-impact hardware flow.
- Pause, Stop, Take Over, durable audit/export/clear, remote services, telemetry, database
  storage, generic chat UI, rollback, or checkpoint promises.
- Stable device identity. A successful serial signal may save existing connection parameters
  only if the user opts in; it must not claim a verified board identity.

## Ownership model

```text
Renderer Start Center / First Success UI
  -> explicit user action with SerialConnectionDraft
    -> existing session create/open path
      -> Main-owned FirstSignalObservationService
        -> transcript replay + continuous session listener
          -> firstSignal IPC/preload DTOs
            -> renderer first-success reducer/coordinator
              -> useTranscript/renderEventToXterm visible ack
                -> lastVisibleDeviceSequence -> completed
```

Main owns attempts, revisions, timers, session listener registration, baseline cursor,
session terminal cleanup, display-safe observation DTOs, and subscriber cleanup. Renderer owns
the local first-success view state, user-selected draft review state, xterm write completion
acknowledgement, focus policy, and recovery UI.

## FirstSignalObservation contract

The shared DTO is strict and versioned with `schemaVersion: '1.0.0'`.

Fields:

- `attemptId`: Main-minted stable id for one first-signal attempt.
- `clientAttemptKey`: non-authoritative renderer idempotency key.
- `revision`: monotonic per attempt; renderer ignores older revisions.
- `sessionId`: existing session id.
- `ownsSession`: whether the guided flow created this session and may close it on
  Disconnect and edit.
- `baselineCursor`: transcript cursor captured before observation.
- `state`: `waiting | signal-detected | silent | closed | errored | stopped`.
- `startedAt`, `updatedAt`, `timeoutMs`, optional `silentSince`, optional `observedAt`,
  optional `observedSequence`, optional `closedReason`, and optional display-safe error.

Main start semantics:

- `start` mints an `attemptId`.
- Same `clientAttemptKey + sessionId` is idempotent and returns the existing active
  observation.
- Same `clientAttemptKey` with a different session is a safe conflict.
- Baseline cursor defaults to the latest transcript cursor before the monitor starts.
- Listener is established before replay/status hydration to close the data-before-status
  race.

Main lifecycle semantics:

- Observation listens continuously from baseline and does not consume or advance the renderer
  transcript subscriber cursor.
- Silence timer changes state to non-terminal `silent` only; listener remains active.
- A first non-empty device transcript event sets `signal-detected` with `observedSequence`
  and keeps enough state for renderer visibility acknowledgement.
- State/error/outgoing/clear events, empty device chunks, and malformed events do not count.
- Terminal session close, runtime shutdown, explicit stop, or unrecoverable observation error
  transitions to terminal `closed`/`stopped`/`errored` and clears listeners/timers.
- Terminal observations are retained for a bounded reload window, then expired.

## Visible-device acknowledgement

Renderer cannot complete the journey when Main detects data. The terminal transcript adapter
must maintain `lastVisibleDeviceSequence`:

- only non-empty `device` text can advance it;
- the relevant `term.write` completion callback or equivalent awaitable acknowledgement must
  resolve successfully;
- the terminal must still be mounted and belong to the same session/attempt;
- partial UTF-8 chunks that decode to no text do not advance it;
- state/error/outgoing/clear/local lines do not advance it;
- delayed callbacks after dispose/unmount do not advance it;
- replay must render each event once and must not double-complete the attempt.

Renderer derives signal-visible when
`observation.observedSequence <= lastVisibleDeviceSequence` for the same `sessionId` and
current `attemptId`.

## FirstSuccessViewState

Renderer-local state is not a boundary DTO. It is derived from readiness, selected draft,
session create/open result, first-signal observation, transcript hydration/visible ack, and
terminal/display availability.

Required phases:

- `checking`
- `needs-device`
- `ready-to-connect`
- `reviewing-plan`
- `connecting`
- `waiting-for-output`
- `data-received`
- `display-unavailable`
- `silent`
- `errored`
- `disconnected`
- `cancelled`
- `completed`

The reducer must be pure and tested separately from React. It must bind all observation and
transcript evidence to `attemptId + sessionId`; stale attempt events cannot complete a newer
attempt.

## Guided connection and plan review

Phase 4 promotes the Phase 3 Start Center observe intent into a real guided flow:

- Candidate/manual serial selection produces or reuses `SerialConnectionDraft`.
- The plan review displays:
  - port label and baud/data/stop/parity/mode values;
  - parameter source/default metadata;
  - port reservation/exclusive use wording;
  - no-payload-during-connect guarantee;
  - DTR/RTS/control-line behavior as configured/known/transport-derived/unknown;
  - possible board reset wording when applicable or unknown.
- User must explicitly confirm connect.
- Candidate disappearance, changed live evidence, invalid draft, or conflict blocks connect
  and requires revalidation.
- Connect uses existing session create/open paths and must not bypass SessionManager.
- Open failure maps to `errored`; a guided-flow-created errored session may be cleaned up
  after evidence is captured so it does not leave an orphan tab or reserve the port.

## Recovery actions

Required actions:

- Keep waiting: keeps monitor/timer/listener and does not create a new attempt.
- Disconnect and edit: only visible when `ownsSession=true`; stops observation, closes the
  guided session through existing session APIs, releases the port, and returns to the draft.
- Back to session: visible when `ownsSession=false` or when the user chooses to preserve the
  session; stops observation and keeps the session.
- Disconnect: explicit user disconnect; records user reason and closes the session through
  existing session APIs.
- Retry: starts a new attempt only after the previous attempt is stopped/cleaned up.
- Go to terminal: available after signal visible or when the user wants to inspect an open
  silent/display-unavailable session.

All recovery paths are idempotent and clear attempt-owned timers/listeners. User, transport,
session-closed, and runtime-shutdown reasons remain distinct in UI and tests.

## Focus policy

Signal visible may focus the terminal only if:

- the active surface is still the first-success flow for that attempt;
- no modal/dialog/text input/approval-like surface has focus;
- the user has not navigated to Activity Center, advanced connection, or another session;
- the signal is not a stale late event for an old attempt.

Otherwise the UI updates status and shows Go to terminal without stealing focus.

## IPC and preload

Phase 4 adds first-signal channels:

```text
firstSignal:start
firstSignal:status
firstSignal:stop
firstSignal:subscribe
firstSignal:unsubscribe
firstSignal:event
```

The preload namespace exposes narrow methods such as:

```ts
window.linkterm.firstSignal.start(req)
window.linkterm.firstSignal.status(req)
window.linkterm.firstSignal.stop(req)
window.linkterm.firstSignal.subscribe(req)
window.linkterm.firstSignal.unsubscribe()
window.linkterm.firstSignal.onEvent(handler, onInvalidPayload?)
```

Renderer must register the local event listener before subscribe/status hydration. Main must
unregister destroyed windows, tolerate send races, reject malformed payloads with safe errors,
and never expose internal Main-owned objects.

## Optional successful connection save

After `completed`, the user may save the successful serial connection using existing profile
schema fields only. Saving is optional and not a completion precondition. Failure to save must
not roll back completion, and saved data must not claim verified/stable hardware identity.

## Accessibility, i18n, and performance

- All first-success labels, statuses, diagnostics, recovery actions, plan review fields, and
  errors require English and Chinese strings.
- Status must use text/roles rather than color alone.
- Keyboard users can complete plan review, connect, keep waiting, retry, disconnect/edit,
  back to session, go to terminal, and save/skip profile.
- Reduced-motion states avoid unbounded animation.
- High-frequency transcript events do not enter Activity Center as raw terminal content and
  must not degrade terminal input/scrolling.

## Risks and mitigations

- **Completing too early**: require xterm completion ack and `lastVisibleDeviceSequence`.
- **Missing late signal**: silent is non-terminal and monitor continues.
- **Renderer reload race**: Main attempt/revision retention plus listener-before-status.
- **Duplicate render/completion**: sequence-bound replay and idempotent reducers.
- **Orphaned ports/sessions**: ownsSession-specific cleanup and explicit recovery actions.
- **Focus theft**: conditional focus policy with stale-attempt isolation.
- **Scope creep into Phase 5/6/7/8**: no approval broker, J-Link/RTT, Pause, or audit
  implementation in this change.

## Migration plan

1. Add shared first-signal schemas and pure core observation state tests.
2. Add Main observation service over existing session/transcript adapters with fake sessions.
3. Add first-signal IPC/preload/mock bridge.
4. Upgrade renderer transcript rendering to expose xterm visible-device acknowledgement.
5. Add renderer first-success reducer/coordinator and UI plan/recovery components.
6. Wire Start Center observe intent to the guided serial flow.
7. Add optional successful-connection save after completed state if it fits existing schema
   without identity claims.
8. Run focused tests after each slice, then full quality/GitNexus/review closeout.
