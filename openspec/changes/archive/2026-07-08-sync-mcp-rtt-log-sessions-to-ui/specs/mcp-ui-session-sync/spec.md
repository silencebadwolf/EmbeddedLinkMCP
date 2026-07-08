## ADDED Requirements

### Requirement: MCP-created sessions are visible in the App

When an MCP tool creates or reuses a managed session, LinkTerm SHALL make that session visible to App windows through the same session listing, lifecycle, and transcript APIs used by human-created sessions.

#### Scenario: MCP opens an RTT log session

- **GIVEN** the MCP server and App share the same `SessionManager`
- **WHEN** `open_rtt_log_session` opens or reuses an RTT log session
- **THEN** `session:list` hydration SHALL include the RTT log session summary
- **AND** the summary SHALL include `connectionType="rtt-log"` and RTT metadata for `probeId` and `channelIndex`
- **AND** App lifecycle listeners SHALL be able to observe creation and later state changes for that session
- **AND** an already-open App window SHALL select the AI-created session so the observation terminal is immediately visible

#### Scenario: App window missed the initial lifecycle event

- **GIVEN** an App window subscribes after an MCP-created RTT log session already exists
- **WHEN** the renderer hydrates from `session:list`
- **THEN** it SHALL add the RTT log session to the App session store
- **AND** it SHALL keep later state changes synchronized through lifecycle events

### Requirement: Session state changes use manager lifecycle semantics

LinkTerm SHALL forward explicit `SessionManager` state transitions to App windows as session lifecycle updates instead of relying only on transcript data events.

#### Scenario: Session emits state without transcript state data

- **GIVEN** a managed session changes state and `SessionManager` emits `session:state`
- **WHEN** App lifecycle IPC is registered
- **THEN** LinkTerm SHALL broadcast a `stateChanged` lifecycle event with the current `SessionSummary`
- **AND** the renderer SHALL be able to update the visible tab state without requiring a transcript subscription

#### Scenario: Transcript forwarding remains independent

- **GIVEN** an App terminal has subscribed to a session transcript
- **WHEN** transcript data, clear, error, or state events are emitted
- **THEN** LinkTerm SHALL continue forwarding transcript events through the transcript channel
- **AND** lifecycle forwarding SHALL NOT require a transcript subscription to exist

### Requirement: Silent RTT log sessions remain diagnosable

When an RTT log session opens successfully but no target bytes are available yet, LinkTerm SHALL make that state visible in the shared transcript and avoid implying that flash should be repeated.

#### Scenario: RTT channel opens with no firmware output yet

- **GIVEN** an RTT log session has connected to a probe and channel
- **WHEN** the first RTT poll returns zero device bytes
- **THEN** the session SHALL remain `open`
- **AND** the transcript SHALL contain a system-origin data event saying the RTT log is connected and waiting for target output
- **AND** that guidance SHALL direct the operator toward firmware RTT output, channel, or control block checks
- **AND** it SHALL NOT suggest repeating flash solely because the RTT channel is silent

### Requirement: Profile-based RTT log open owns managed GDB setup

When a caller opens continuous RTT observation from a workspace root/control profile, LinkTerm SHALL treat that request as the high-level observation intent and SHALL NOT require a separate low-level `gdb_server_start` call before creating the App-visible RTT log session.

#### Scenario: App opens RTT log from a workspace profile

- **GIVEN** a workspace control profile has `jlink.enabled=true`, a valid J-Link target, and `rtt.enabled=true`
- **WHEN** the App requests RTT log open with the workspace `root`
- **THEN** LinkTerm SHALL connect the configured J-Link probe
- **AND** LinkTerm SHALL start the managed GDB server required for RTT transport ownership
- **AND** LinkTerm SHALL connect RTT and select the configured or first visible up channel
- **AND** LinkTerm SHALL open or reuse an App-visible `rtt-log` session

#### Scenario: MCP opens RTT log from a workspace profile

- **GIVEN** the MCP server has access to the workspace control profile manager
- **WHEN** `open_rtt_log_session` is called with a workspace `root`
- **THEN** the tool SHALL perform profile-based J-Link connect, managed GDB server startup, RTT connect, and shared RTT log session open inside that single tool call
- **AND** the returned evidence SHALL include the session id, probe id, selected channel, reuse status, and whether managed GDB was started
- **AND** callers SHALL NOT need to call `gdb_server_start` separately solely to make continuous RTT log observation work

#### Scenario: RTT telnet endpoint becomes ready after the GDB server

- **GIVEN** LinkTerm has started the managed GDB server for RTT observation
- **AND** the GDB server has returned an RTT telnet port
- **WHEN** the first RTT telnet connection attempt fails because the endpoint is not ready yet
- **THEN** LinkTerm SHALL wait and retry that RTT connection for a bounded period
- **AND** LinkTerm SHALL open the App-visible RTT log session if the endpoint becomes ready
- **AND** LinkTerm SHALL NOT repeat flash, reset the CPU, or ask the caller to invoke low-level `gdb_server_start`

#### Scenario: Existing probe RTT log open remains available

- **GIVEN** RTT has already been prepared for a connected probe
- **WHEN** `open_rtt_log_session` is called with `probeId`
- **THEN** LinkTerm SHALL preserve the existing probe-based reuse behavior
- **AND** LinkTerm SHALL NOT start a new GDB server implicitly for that low-level reuse path
