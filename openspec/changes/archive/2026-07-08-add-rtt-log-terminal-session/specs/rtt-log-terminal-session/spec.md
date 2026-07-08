## ADDED Requirements

### Requirement: RTT log session opens from an existing backend RTT connection
LinkTerm SHALL provide a managed RTT log session that is created from an existing connected J-Link probe and RTT up-channel without exposing SEGGER, GDB, or socket details to the renderer or MCP caller.

#### Scenario: Open RTT log session from connected probe
- **WHEN** an RTT log session is opened with a valid `probeId`, `channelIndex`, `pollIntervalMs`, and `maxBytesPerRead`
- **THEN** LinkTerm registers a new session with explicit RTT log metadata
- **AND** the session enters `open` state and is visible through normal session listing and lifecycle events

#### Scenario: Open fails without RTT backend readiness
- **WHEN** the backend reports that RTT is not connected for the requested probe or channel
- **THEN** LinkTerm returns a structured failure or errored session state
- **AND** it does not start a GDB server, spawn external tools, or guess missing debug configuration

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

### Requirement: RTT log terminal is read-only
LinkTerm SHALL treat RTT log terminal sessions as read-only until an explicit RTT down-channel capability is added.

#### Scenario: User types in RTT log tab
- **WHEN** the renderer receives keyboard input while an RTT log session tab is active
- **THEN** LinkTerm does not send those bytes to the backend
- **AND** no transport write is attempted through `SessionManager.write`

#### Scenario: MCP writes to RTT log session
- **WHEN** an MCP client calls a generic session write tool against an RTT log session
- **THEN** LinkTerm returns a structured non-writable-session error
- **AND** no backend RTT write or external command is attempted

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
