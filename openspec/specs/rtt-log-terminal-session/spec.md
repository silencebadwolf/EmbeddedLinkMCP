# rtt-log-terminal-session Specification

## Purpose
Define LinkTerm's managed RTT log terminal sessions: continuous App-visible RTT observation, shared UI/MCP transcript access, profile-based J-Link/RTT preparation, capability-backed RTT down-channel input, and diagnostics for silent or unanswered RTT sessions.

## Requirements
### Requirement: RTT log session opens from an existing backend RTT connection

LinkTerm SHALL provide a managed RTT log session that is created from either a workspace control profile or an existing connected J-Link probe and RTT up-channel without exposing SEGGER, GDB, or socket details to the renderer or MCP caller.

#### Scenario: Manual App open uses workspace control profile

- **GIVEN** the user opens the New Connection dialog and selects `RTT Log`
- **WHEN** the user provides a workspace root with a valid control profile and clicks Create
- **THEN** the renderer SHALL call `rttLog.open` with that `root` and the requested channel
- **AND** the App SHALL create or reuse a visible `rtt-log` tab using the returned `probeId` and `channelIndex`
- **AND** the user SHALL NOT need to know or enter an internal LinkTerm probe handle

#### Scenario: Manual App open can reuse an existing probe handle

- **GIVEN** the user opens the New Connection dialog and selects `RTT Log`
- **WHEN** the user provides a probe id and channel without a workspace root
- **THEN** the renderer SHALL call `rttLog.open` with that `probeId` and channel
- **AND** LinkTerm SHALL preserve the existing probe-handle fallback behavior

#### Scenario: Manual App open can save an RTT log profile

- **GIVEN** the user opens the New Connection dialog and selects `RTT Log`
- **WHEN** the user provides a workspace root, checks save as global connection, and clicks Create
- **THEN** the renderer SHALL call `connections.saveAndOpen` with `config.type="rtt-log"` and the workspace root
- **AND** the saved profile SHALL appear in the saved-connection list with non-sensitive RTT target fields
- **AND** the user SHALL NOT need to know or enter an internal LinkTerm probe handle

#### Scenario: RTT log saved profiles reject transient probe handles

- **GIVEN** the user opens the New Connection dialog and selects `RTT Log`
- **WHEN** the user provides only a probe id, checks save as global connection, and clicks Create
- **THEN** the renderer SHALL show a validation error requiring a workspace root
- **AND** the renderer SHALL NOT call `connections.saveAndOpen`
- **AND** LinkTerm saved-profile schemas SHALL reject `type="rtt-log"` configs without `root`

#### Scenario: Saved RTT log profile reopens through RTT target preparation

- **GIVEN** a saved connection profile has `type="rtt-log"` and a workspace root
- **WHEN** the user opens it from the saved-connection list
- **THEN** LinkTerm SHALL route the open through the RTT log session path
- **AND** LinkTerm SHALL prepare J-Link/GDB/RTT from the workspace control profile
- **AND** LinkTerm SHALL NOT route the saved RTT profile through generic `session.create`
- **AND** the App SHALL create or reuse a visible `rtt-log` tab using the returned `probeId` and `channelIndex`

#### Scenario: RTT log terminal accepts human input

- **GIVEN** an App-visible `rtt-log` tab is open
- **WHEN** the user types into the terminal
- **THEN** the renderer SHALL call the existing `session.write` IPC path for that session
- **AND** LinkTerm SHALL forward the bytes only to a configured RTT down-channel reported by the J-Link backend
- **AND** the transcript SHALL record the write with `origin="human"`
- **AND** the terminal SHALL render the local input bytes so the user can see that input was accepted even when the target firmware does not echo RTT input

#### Scenario: RTT log terminal receives keyboard focus

- **GIVEN** an App-visible `rtt-log` tab is opened or selected
- **WHEN** the terminal view is mounted or the user clicks the terminal area
- **THEN** LinkTerm SHALL focus the xterm instance so manual keyboard input is sent through the session write path
- **AND** the user SHALL NOT need to click an invisible nested xterm element before typing

#### Scenario: RTT log Enter uses command-line line ending

- **GIVEN** an App-visible `rtt-log` tab is open
- **WHEN** the user presses Enter and xterm emits a bare carriage return byte
- **THEN** the renderer SHALL send carriage-return plus line-feed bytes through `session.write`
- **AND** LinkTerm SHALL preserve non-Enter bytes unchanged

#### Scenario: RTT log write failure is visible in the App

- **GIVEN** an App-visible `rtt-log` tab is open
- **WHEN** a terminal write returns a structured failure result
- **THEN** the renderer SHALL render a visible error line in that terminal
- **AND** the renderer SHALL NOT mark the write as successful human activity

#### Scenario: RTT write requires a down-channel capability

- **GIVEN** the J-Link RTT backend has connected to RTT metadata
- **WHEN** `rttWrite` is called for a channel index without a matching `direction="down"` channel
- **THEN** LinkTerm SHALL reject the write with an invalid-state error
- **AND** it SHALL NOT append a misleading human or AI data audit event for bytes that were not accepted as down-channel input

#### Scenario: MCP writes share the RTT terminal input path

- **GIVEN** an App-visible `rtt-log` session is open
- **WHEN** an MCP client calls `write_to_session` or `send_and_wait` for that session
- **THEN** LinkTerm SHALL forward the bytes through the same session write queue as human input
- **AND** the transcript SHALL record the write with `origin="ai"`
- **AND** the terminal SHALL render the local AI input bytes for RTT sessions so App-visible logs and MCP evidence stay synchronized

#### Scenario: App reconciles missed MCP-created RTT sessions

- **GIVEN** an MCP client opens an `rtt-log` session while the App renderer is starting, reloading, or has not yet attached its lifecycle listener
- **WHEN** the App session lifecycle event is missed
- **THEN** the renderer SHALL periodically reconcile `session.list` with its local session store
- **AND** it SHALL add the missing `rtt-log` session as an App-visible tab with the returned RTT metadata
- **AND** AI-created RTT sessions SHALL become active so the human can see the shared log/input surface without manually reopening the connection

#### Scenario: RTT diagnostics report unanswered input

- **GIVEN** an App-visible `rtt-log` session has recorded human or AI input bytes
- **WHEN** no device-origin bytes are recorded after the most recent input event
- **THEN** `diagnose_rtt_log_session` SHALL classify the session as `target_input_unanswered`
- **AND** the diagnosis SHALL report outbound write event count, outbound byte count, and device bytes observed after the most recent write
- **AND** the diagnosis SHALL tell agents not to treat host write acceptance as successful board interaction until device-origin output or another firmware-side acknowledgement is observed

#### Scenario: Agent runbook prevents RTT write-success misinterpretation

- **GIVEN** an AI client reads LinkTerm initialize instructions or calls `get_agent_runbook`
- **WHEN** the runbook describes RTT terminal writes
- **THEN** it SHALL state that `bytesWritten` from `write_to_session` or `send_and_wait` is host-side acceptance only for RTT sessions
- **AND** it SHALL require later device-origin output or a `diagnose_rtt_log_session` result other than `target_input_unanswered` before claiming the target firmware consumed RTT input

#### Scenario: MCP UI patches can prefill RTT log connection fields

- **GIVEN** an MCP client sends `ui_configure` with `open_connection_dialog`
- **WHEN** the prefill contains `type="rtt-log"` and non-sensitive RTT fields
- **THEN** LinkTerm SHALL accept the patch
- **AND** the App SHALL open the New Connection dialog on `RTT Log`
- **AND** the App SHALL prefill the RTT workspace/channel/probe fields through the normal visible form

### Requirement: RTT log bytes are appended to an AI-readable transcript
LinkTerm SHALL poll bounded chunks from the backend RTT channel and append received bytes to the RTT log session transcript as device-origin data events.

#### Scenario: Backend returns RTT bytes
- **WHEN** the RTT backend returns bytes during a poll
- **THEN** LinkTerm appends one or more transcript data events with `origin="device"`
- **AND** UI and AI clients can read those bytes through existing transcript subscription and cursor APIs

#### Scenario: Backend returns no bytes
- **WHEN** a poll reads zero bytes
- **THEN** LinkTerm keeps the RTT log session open
- **AND** it does not append empty data events or busy-loop faster than the configured polling interval

### Requirement: RTT log session lifecycle is bounded and clean
LinkTerm SHALL stop polling and release local resources when an RTT log session is closed, destroyed, or enters an error state.

#### Scenario: Close RTT log session
- **WHEN** the RTT log session is closed or destroyed
- **THEN** LinkTerm stops its polling loop
- **AND** no further RTT bytes are appended to that session transcript after close completes

#### Scenario: Polling error occurs
- **WHEN** the backend throws during RTT polling
- **THEN** LinkTerm records a bounded error event in the session transcript
- **AND** transitions the session to `errored` without retrying indefinitely

### Requirement: RTT log sessions remain distinct from one-shot debug RTT tools
LinkTerm SHALL keep existing `rtt_read`, `rtt_search`, and `rtt_clear` debug tools available and preserve their debug evidence semantics.

#### Scenario: One-shot RTT read still returns debug evidence
- **WHEN** a caller invokes the existing `rtt_read` tool
- **THEN** LinkTerm returns `debug_output` evidence with base64 RTT data
- **AND** it does not require an RTT log terminal session to exist

#### Scenario: Active RTT log session owns the channel read stream
- **WHEN** an RTT log session is actively polling a probe/channel
- **THEN** LinkTerm prevents a second active RTT log session from consuming the same probe/channel independently
- **AND** the caller receives either the existing session id or a structured conflict response

### Requirement: Agent guidance identifies RTT log terminal usage
LinkTerm SHALL describe the RTT log terminal path in AI-facing status or runbook guidance so agents choose it for continuous log observation and use one-shot debug tools for bounded evidence reads/searches.

#### Scenario: Agent asks for runtime guidance
- **WHEN** an AI client requests LinkTerm runbook or app status guidance
- **THEN** the response identifies the RTT log terminal path for continuous observation
- **AND** distinguishes it from `rtt_read/search/clear` debug evidence tools

### Requirement: RTT log silence is classified separately from flash failure

When an RTT log session is open but no firmware-origin log bytes are visible, LinkTerm SHALL classify the state as an RTT output diagnostic instead of implying that firmware download, flash verify, or target reset failed.

#### Scenario: SEGGER banner only is observed

- **GIVEN** an RTT log session has an open shared transcript
- **AND** the transcript contains LinkTerm system open guidance
- **AND** device-origin bytes contain only SEGGER RTT transport banner lines
- **WHEN** LinkTerm diagnoses that session
- **THEN** the result SHALL report that RTT transport evidence is present
- **AND** the result SHALL report that firmware-output bytes are not present
- **AND** the recommended next actions SHALL point to firmware RTT output, selected channel, or control block checks
- **AND** the recommended next actions SHALL NOT recommend repeating flash solely because RTT is silent

#### Scenario: Firmware output is observed after the banner

- **GIVEN** an RTT log session transcript contains SEGGER transport banner bytes
- **AND** later device-origin bytes contain target firmware log text or binary bytes
- **WHEN** LinkTerm diagnoses that session
- **THEN** the result SHALL classify the session as firmware output seen
- **AND** it SHALL report a non-zero firmware-output byte count

#### Scenario: App-visible transcript explains banner-only evidence

- **GIVEN** an RTT log session is polling a channel
- **WHEN** a poll returns SEGGER transport banner bytes and no firmware-output bytes
- **THEN** LinkTerm SHALL append a system-origin transcript message explaining that the banner proves RTT transport but not firmware logging
- **AND** it SHALL append that banner-only explanation at most once per session

### Requirement: RTT log session diagnosis is available through MCP

LinkTerm SHALL expose a read-only MCP tool named `diagnose_rtt_log_session` for classifying an existing App-visible RTT log session transcript.

#### Scenario: Diagnose an RTT log session

- **GIVEN** an active session with `connectionType="rtt-log"`
- **WHEN** an MCP client calls `diagnose_rtt_log_session` with its `sessionId`
- **THEN** LinkTerm SHALL return structured diagnostic evidence for that session
- **AND** the tool SHALL NOT connect probes, start GDB, reset, halt, flash, erase, write memory, write terminals, or create new sessions

#### Scenario: Diagnose a non-RTT session

- **GIVEN** an active session whose `connectionType` is not `rtt-log`
- **WHEN** an MCP client calls `diagnose_rtt_log_session` with that `sessionId`
- **THEN** LinkTerm SHALL return a structured invalid-argument failure
- **AND** it SHALL NOT read hardware or mutate the session
