## ADDED Requirements

### Requirement: Main-owned first-signal observation tracks serial device data independently from session open
LinkTerm SHALL provide a Main/core first-signal observation model for guided serial first success. Starting an observation MUST mint a Main-owned `attemptId`, bind it to `sessionId`, `clientAttemptKey`, `ownsSession`, and `baselineCursor`, and publish strict display-safe observations with monotonic revisions. The observation MUST listen continuously from the baseline transcript cursor, MUST NOT advance or consume the Renderer transcript subscriber cursor, and MUST distinguish `waiting`, `signal-detected`, `silent`, `closed`, `errored`, and `stopped`.

#### Scenario: Start is idempotent for the same client key and session
- **WHEN** the renderer starts first-signal observation twice with the same `clientAttemptKey` and `sessionId`
- **THEN** Main returns the existing observation with the same `attemptId`
- **AND** no duplicate listener or timer is registered

#### Scenario: Same client key is reused for a different session
- **WHEN** the renderer starts observation with an existing `clientAttemptKey` but a different `sessionId`
- **THEN** Main rejects the request with a safe conflict error
- **AND** no new observation is started

#### Scenario: Device data arrives before status hydration
- **WHEN** non-empty device data is appended after observation start but before the renderer receives status
- **THEN** the observation records `signal-detected` with the device event sequence
- **AND** the pushed event or later status includes a revision greater than the start revision
- **AND** the data is not missed because the listener was established before replay/status hydration

#### Scenario: Silent timeout is not terminal
- **WHEN** no non-empty device data arrives before the silence timeout
- **THEN** the observation state becomes `silent`
- **AND** the listener remains active
- **AND** a later non-empty device event on the same attempt transitions to `signal-detected`

#### Scenario: Observation cleanup is idempotent
- **WHEN** an observation is stopped, the session closes, or runtime shutdown cleanup runs
- **THEN** timers and listeners for that attempt are removed exactly once
- **AND** repeated stop/cleanup does not throw or leak subscribers

### Requirement: First-signal IPC and preload expose strict display-safe lifecycle DTOs
LinkTerm SHALL expose first-signal observation through typed Main IPC and a narrow preload namespace. Renderer MUST register pushed-event listeners before subscribe/status hydration, MUST ignore stale revisions, and MUST convert malformed responses or pushed events into bounded safe diagnostics. IPC/preload MUST NOT expose `ipcRenderer`, internal Main objects, raw errors/stacks, raw transcript internals beyond existing transcript rendering, approval/grant/lease/compensation objects, J-Link handles, firmware bytes, scripts, or credentials.

#### Scenario: Renderer subscribes before status
- **WHEN** the renderer initializes first-signal hydration
- **THEN** it registers the local pushed-event listener first
- **AND** then invokes subscribe or status
- **AND** revisions newer than the hydrated status are applied
- **AND** older revisions are ignored without corrupting state

#### Scenario: Malformed first-signal payload is received
- **WHEN** Main, preload, or a test fixture sends a malformed first-signal response or event
- **THEN** renderer first-success state records a bounded safe diagnostic
- **AND** the malformed payload is not retained in React state
- **AND** no raw payload, stack, or unknown field is displayed

#### Scenario: Window is destroyed during observation updates
- **WHEN** a subscribed renderer window is destroyed or its webContents send fails
- **THEN** Main removes that subscriber
- **AND** other subscribers and the Main-owned observation continue unaffected

### Requirement: Signal visible requires xterm completion acknowledgement of non-empty device text
LinkTerm SHALL treat first success as complete only when the observed non-empty `device` transcript event has been rendered and acknowledged visible by xterm write completion callback or an equivalent asynchronous renderer acknowledgement. Main detection alone, session open, synchronous `term.write` return, state/error/outgoing/clear events, empty or incomplete UTF-8 chunks, delayed callbacks after dispose/unmount, and stale attempts MUST NOT complete the journey.

#### Scenario: Device text becomes visible
- **WHEN** Main observes non-empty device transcript sequence N for the current attempt
- **AND** Renderer hydrates/renders that device text
- **AND** the xterm write completion callback or equivalent async acknowledgement succeeds while the terminal is mounted
- **THEN** Renderer advances `lastVisibleDeviceSequence` to at least N
- **AND** first-success state becomes `completed`

#### Scenario: Main detects data but terminal display is unavailable
- **WHEN** Main observes non-empty device sequence N
- **AND** Renderer transcript subscription or terminal hydration is unavailable
- **THEN** first-success state becomes `display-unavailable`
- **AND** LinkTerm does not claim journey completion
- **AND** replay after display recovery can complete only after the xterm completion acknowledgement for sequence N

#### Scenario: Incomplete UTF-8 and state events do not complete
- **WHEN** an incomplete UTF-8 device chunk is followed by a state event with a higher sequence
- **THEN** `lastVisibleDeviceSequence` is not advanced by the state event
- **AND** first success remains incomplete until non-empty device text is decoded and xterm-acknowledged visible

#### Scenario: Terminal is disposed before write callback
- **WHEN** xterm write callback fires after the terminal has been disposed or unmounted
- **THEN** `lastVisibleDeviceSequence` does not advance
- **AND** the first-success attempt does not complete from that delayed callback

#### Scenario: Replay renders exactly once
- **WHEN** transcript replay includes a device event already rendered for the current session
- **THEN** the renderer does not duplicate visible terminal output
- **AND** the first-success completion transition is idempotent

### Requirement: Guided serial plan review connects only after explicit user confirmation
LinkTerm SHALL promote the Start Center observe intent into a guided serial first-success flow. The flow MUST show a reviewable serial connection plan before connecting, including selected port, serial settings, parameter sources, port reservation/exclusive use, no-payload-during-connect guarantee, DTR/RTS/control-line behavior when known or unknown, and potential reset wording when applicable. Connect MUST use existing session creation/opening paths and MUST NOT bypass SessionManager, WriteQueue, or Transport.

#### Scenario: User reviews and confirms a serial plan
- **WHEN** the user chooses a candidate or manual serial port
- **THEN** LinkTerm displays a connection plan derived from `SerialConnectionDraft`
- **AND** the user must explicitly confirm before a session create/open request is issued
- **AND** the connect path sends no serial payload during connect

#### Scenario: Candidate changes before connect
- **WHEN** the selected candidate disappears or conflicting live evidence is detected before connect
- **THEN** LinkTerm blocks the guided connect
- **AND** asks the user to refresh, choose another candidate, or edit manually
- **AND** no session is created from stale candidate evidence

#### Scenario: Existing professional connection remains available
- **WHEN** the user chooses Advanced connection instead of the guided plan
- **THEN** LinkTerm opens the existing ConnectionDialog path
- **AND** first-signal guided state does not auto-connect or claim completion

### Requirement: Renderer first-success state provides distinct recovery for open, silent, detected, display-unavailable, errored, and disconnected states
LinkTerm SHALL provide a renderer-local first-success state model with distinct phases for checking, needs-device, ready-to-connect, reviewing-plan, connecting, waiting-for-output, data-received, display-unavailable, silent, errored, disconnected, cancelled, and completed. Recovery actions MUST be explicit, idempotent, and bound to `attemptId + sessionId`. Late events from old attempts MUST NOT complete or alter a newer attempt.

#### Scenario: Keep waiting in silent state
- **WHEN** an observation is `silent`
- **AND** the user activates Keep waiting
- **THEN** LinkTerm keeps the same monitor, listener, timer state, and attempt
- **AND** does not create a new session or new first-signal attempt

#### Scenario: Disconnect and edit for an owned session
- **WHEN** the guided flow created the session and `ownsSession=true`
- **AND** the user activates Disconnect and edit
- **THEN** LinkTerm stops the observation
- **AND** closes the guided session through existing session APIs
- **AND** returns to the editable draft without leaving the port reserved by the guided flow

#### Scenario: Back to session for a reused session
- **WHEN** the flow is observing an existing session with `ownsSession=false`
- **AND** the user activates Back to session
- **THEN** LinkTerm stops first-signal observation
- **AND** preserves the session
- **AND** returns focus/navigation to the terminal session without claiming first success unless visible acknowledgement already happened

#### Scenario: User disconnect is distinct from transport disconnect
- **WHEN** the user explicitly disconnects from the first-success UI
- **THEN** the state records a user disconnect reason
- **AND** the UI does not present it as physical transport failure

#### Scenario: Retry isolates old attempts
- **WHEN** the user retries after an error, disconnect, or cancelled attempt
- **THEN** LinkTerm stops/cleans up the previous attempt
- **AND** starts a new attempt with a new `attemptId`
- **AND** old delayed first-signal events or xterm callbacks cannot complete the new attempt

### Requirement: Signal-visible focus policy is conditional and non-stealing
LinkTerm SHALL focus the terminal after signal-visible completion only when the user is still in the matching first-success flow, no modal/dialog/text input or higher-priority surface has focus, and the event belongs to the current attempt. Late signal or recovery completion MUST update status without stealing focus from Activity Center, approval-like surfaces, advanced connection forms, other sessions, or active text inputs.

#### Scenario: User remains in first-success flow
- **WHEN** signal-visible completion occurs for the current attempt
- **AND** the user is still on the first-success flow without modal/input conflict
- **THEN** LinkTerm may focus the terminal

#### Scenario: User moved to another surface
- **WHEN** signal-visible completion occurs after the user moved to Activity Center, another session, advanced connection, or a focused input
- **THEN** LinkTerm updates first-success status
- **AND** offers Go to terminal
- **AND** does not steal focus

### Requirement: Optional save after success uses existing profile schema and does not redefine completion
LinkTerm MAY offer to save the successful serial connection after signal-visible completion. Saving MUST use existing supported serial profile fields only, MUST be optional, MUST NOT be required for first success, and MUST NOT claim stable or verified device identity.

#### Scenario: User skips saving after completion
- **WHEN** first success is completed
- **AND** the user skips saving the connection
- **THEN** the first-success completion remains valid

#### Scenario: Save fails after completion
- **WHEN** first success is completed
- **AND** saving the connection profile fails
- **THEN** LinkTerm reports the save failure safely
- **AND** does not roll back first-success completion

### Requirement: Phase 4 is accessible, bilingual, bounded, and limited to serial first signal
LinkTerm SHALL provide English and Chinese copy for every new Phase 4 label, status, diagnostic, action, disabled reason, plan-review message, and recovery message. The first-success flow SHALL support keyboard operation, non-color-only state communication, reduced-motion-safe presentation, bounded diagnostics/rendering, and terminal-adjacent performance. Phase 4 MUST NOT implement Human Approval, J-Link/RTT first signal, firmware download/flash/verify, Pause/Take Over, durable audit/export/clear, cloud services, telemetry, database storage, generic chat UI, or hardware rollback promises.

#### Scenario: First-success flow is keyboard operated
- **WHEN** the user navigates the guided serial first-success flow by keyboard
- **THEN** plan review, connect, keep waiting, retry, disconnect/edit, back to session, disconnect, and go to terminal controls are reachable
- **AND** when the optional save-after-success offer is present, save and skip controls are reachable
- **AND** each state has a readable label

#### Scenario: Phase 4 scope is inspected
- **WHEN** the Phase 4 implementation is complete
- **THEN** no `PreparedOperation`, approval grant, authorization record, pause lease, J-Link/RTT download-observe flow, durable JSONL writer, export/clear implementation, database, cloud service, telemetry service, generic chat UI, or hardware rollback mechanism is introduced by this change
- **AND** no real flash, erase, reset, J-Link, RTT, GDB-server, serial payload write, or other hardware side-effect command is executed by Phase 4 validation
