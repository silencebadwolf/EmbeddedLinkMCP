# debug-binary-boundary Specification

## Purpose

Define binary payload limits and backend-local decoding boundaries for debug and flash operations.
## Requirements
### Requirement: Debug binary payload boundaries remain capped and backend-local
LinkTerm SHALL keep binary payload decoding and encoding at MCP boundaries and raw bytes at backend boundaries, while enforcing the shared binary size cap.

#### Scenario: MCP receives base64 binary payload
- **WHEN** a debug MCP tool receives base64 data after required confirmation
- **THEN** the MCP layer validates and decodes it using the shared binary cap
- **AND** the backend receives a `Buffer`

#### Scenario: Backend returns binary data
- **WHEN** the backend returns memory, RTT, snapshot, or flash-related bytes
- **THEN** the MCP layer base64-encodes the bytes before returning JSON-safe evidence
- **AND** it does not write binary debug data to terminal transcripts

#### Scenario: Payload exceeds cap after confirmation
- **WHEN** a confirmed debug payload exceeds the shared cap
- **THEN** LinkTerm returns `BUFFER_TOO_LARGE`
- **AND** the backend is not invoked
