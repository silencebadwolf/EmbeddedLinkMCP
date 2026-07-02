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
