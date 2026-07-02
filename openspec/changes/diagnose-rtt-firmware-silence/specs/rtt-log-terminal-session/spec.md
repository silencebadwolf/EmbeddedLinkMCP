## ADDED Requirements

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
