## MODIFIED Requirements

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

#### Scenario: Backend attaches RTT to configured control block
- **GIVEN** the J-Link backend RTT connect operation receives `controlBlockAddress=0x24005310`
- **WHEN** LinkTerm connects to the SEGGER RTT Telnet endpoint
- **THEN** LinkTerm SHALL configure the Telnet connection to use that control block address during the connection setup window
- **AND** subsequent RTT reads SHALL consume the firmware up buffer selected by that control block
