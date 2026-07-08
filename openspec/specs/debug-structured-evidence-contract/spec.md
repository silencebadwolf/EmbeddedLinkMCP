# debug-structured-evidence-contract Specification

## Purpose

Define the structured, sanitized evidence contract for debug tool results before they are rendered for humans.
## Requirements
### Requirement: Debug evidence is machine-readable before human-readable
LinkTerm SHALL make debug, flash, RTT, GDB, snapshot, and crash-diagnosis evidence machine-readable so AI clients do not need to parse raw SEGGER stdout to determine success or failure.

#### Scenario: Backend returns structured DTO
- **WHEN** a J-Link backend method returns a typed DTO such as registers, memory bytes, breakpoints, RTT data, GDB endpoint, flash result, snapshot, or crash diagnosis
- **THEN** the MCP surface projects that DTO into JSON-safe evidence
- **AND** binary fields are base64-encoded only at the MCP boundary
- **AND** raw SEGGER text is not the only success signal

#### Scenario: Backend exposes diagnostic output preview
- **WHEN** a backend failure includes command output for diagnosis
- **THEN** MCP evidence or error details include only bounded and redacted previews
- **AND** the stable error code remains the primary machine-readable failure classifier

### Requirement: Debug evidence includes call provenance
LinkTerm SHALL preserve operation provenance needed for AI audit without leaking sensitive values.

#### Scenario: MCP caller provides correlation id
- **WHEN** a debug MCP request includes `correlationId`
- **THEN** the result echoes that correlation id
- **AND** the result includes `origin: "ai"`
- **AND** the result includes the LinkTerm schema version

#### Scenario: Operation uses profile or request parameters
- **WHEN** a debug or workflow operation uses target, speed, firmware, address, or verification parameters
- **THEN** evidence or metadata identifies the non-sensitive parameter source where relevant
- **AND** sensitive fields and J-Link serial numbers are not exposed
