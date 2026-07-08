# mcp-debug-boundary-hardening Specification

## Purpose

Define the MCP debug surface boundary, including backend-only hardware access, structured errors, confirmation gates, and schema policy.
## Requirements
### Requirement: Debug MCP surfaces call only the J-Link backend abstraction
LinkTerm debug MCP tools SHALL route all probe, CPU, register, memory, breakpoint, flash, RTT, GDB, snapshot, and crash-diagnosis operations through `IJLinkBackend`.

#### Scenario: Debug tool handles a request
- **WHEN** a debug MCP tool receives valid input
- **THEN** it calls the injected `IJLinkBackend` method corresponding to that tool
- **AND** it does not spawn `JLink.exe`, `JLinkExe`, `JLinkGDBServerCL.exe`, `gdb`, `arm-none-eabi-gdb`, J-Flash, serial CLI tools, or VS Code tasks

#### Scenario: Backend is unavailable
- **WHEN** no real J-Link backend is injected
- **THEN** the debug tool remains registered
- **AND** it returns `NO_BACKEND` as structured failure evidence
- **AND** it does not attempt direct CLI fallback

### Requirement: Debug tool results remain structured and sanitized
LinkTerm debug MCP tools SHALL return structured LinkTerm tool results with stable schema version, `origin: "ai"`, optional correlation id, debug evidence, and stable error codes.

#### Scenario: Debug operation succeeds
- **WHEN** a debug backend operation succeeds
- **THEN** the MCP result includes `success: true`
- **AND** the result includes `origin: "ai"`
- **AND** the result includes the current schema version
- **AND** the evidence kind is debug-specific and machine-readable
- **AND** probe serial numbers and sensitive values are not exposed

#### Scenario: Debug operation fails
- **WHEN** a debug backend operation throws a known J-Link domain error
- **THEN** the MCP result includes `success: false`
- **AND** the result includes a stable error code from LinkTerm's error taxonomy
- **AND** error details are sanitized before crossing the MCP boundary

### Requirement: High-impact debug operations require confirmation before side effects
LinkTerm SHALL require explicit confirmation for high-impact debug and flash operations before payload decoding or backend side effects.

#### Scenario: Flash download is not confirmed
- **WHEN** `flash_download` is called without `confirm=true`
- **THEN** LinkTerm returns `CONFIRMATION_REQUIRED`
- **AND** it does not decode the binary payload
- **AND** it does not call the backend

#### Scenario: Flash write is not confirmed
- **WHEN** `flash_write` is called without `confirm=true`
- **THEN** LinkTerm returns `CONFIRMATION_REQUIRED`
- **AND** it does not decode the base64 payload
- **AND** it does not call the backend

#### Scenario: Reset or GDB server start is not confirmed
- **WHEN** `cpu_reset` or `gdb_server_start` is called without `confirm=true`
- **THEN** LinkTerm returns `CONFIRMATION_REQUIRED`
- **AND** the backend method is not invoked

### Requirement: Debug schema mismatch follows sensitivity policy
LinkTerm SHALL apply schema-version mismatch policy according to debug tool sensitivity.

#### Scenario: State-affecting debug tool has mismatched client schema
- **WHEN** a client calls a state-affecting debug tool with an incompatible schema version
- **THEN** LinkTerm rejects the call with `VERSION_MISMATCH`
- **AND** it does not call the backend

#### Scenario: Read-only debug tool has mismatched client schema
- **WHEN** a client calls a read-only debug tool with a mismatched but tolerated schema version
- **THEN** LinkTerm may return read-only evidence
- **AND** it attaches a schema warning to evidence metadata
