# jlink-debug-backend Specification

## Purpose

Define complete production J-Link backend behavior for registered debug tools, including CPU, register, memory, breakpoint, RTT, snapshot, crash, and flash operations.
## Requirements
### Requirement: Complete registered J-Link backend behavior
LinkTerm SHALL provide real production backend behavior for every registered J-Link MCP/debug tool instead of returning `NOT_IMPLEMENTED` after `probeId` validation.

#### Scenario: Registered tool reaches production backend
- **WHEN** a caller invokes any registered J-Link debug tool with a connected `probeId` and valid arguments
- **THEN** LinkTerm MUST execute the corresponding backend operation or return a domain error that reflects runtime state
- **AND** it MUST NOT return `NOT_IMPLEMENTED` merely because the method is still a stub

#### Scenario: Missing probe is still checked first
- **WHEN** a caller invokes any J-Link debug operation with an unknown or disconnected `probeId`
- **THEN** LinkTerm MUST return `PROBE_NOT_FOUND`
- **AND** it MUST NOT spawn SEGGER tools or touch hardware

### Requirement: Backend-owned SEGGER command execution
LinkTerm SHALL keep all J-Link Commander and GDB server process execution inside the `src/jlink/` backend and runner layer.

#### Scenario: MCP surface handles a debug request
- **WHEN** a debug MCP tool handles CPU, register, memory, breakpoint, RTT, flash, snapshot, or crash diagnosis input
- **THEN** it MUST call `IJLinkBackend`
- **AND** it MUST NOT spawn `JLink.exe`, `JLinkGDBServerCL.exe`, GDB, J-Flash, or any flashing/debug CLI directly

#### Scenario: SEGGER command is needed
- **WHEN** the production backend needs to use SEGGER J-Link software
- **THEN** it MUST use a trusted absolute executable path, shell disabled process execution, bounded output capture, and redaction of probe serial numbers

### Requirement: CPU execution control
LinkTerm SHALL implement CPU halt, run, and single-step through the J-Link backend.

#### Scenario: CPU halt succeeds
- **WHEN** `cpu_halt` is called for a connected probe
- **THEN** LinkTerm MUST issue the backend halt operation
- **AND** return debug evidence indicating the CPU is halted

#### Scenario: CPU run succeeds
- **WHEN** `cpu_run` is called for a connected probe
- **THEN** LinkTerm MUST issue the backend run operation
- **AND** return debug evidence indicating the CPU is running

#### Scenario: CPU step succeeds
- **WHEN** `cpu_step` is called for a connected probe
- **THEN** LinkTerm MUST issue the backend single-step operation
- **AND** return debug evidence indicating that one instruction was stepped

### Requirement: Register access
LinkTerm SHALL implement register read, list, and write for architecture-visible CPU registers.

#### Scenario: Read one register
- **WHEN** `register_read` is called with a register name
- **THEN** LinkTerm MUST return a structured register object containing `name` and numeric `value`

#### Scenario: List registers
- **WHEN** `register_list` is called for a connected probe
- **THEN** LinkTerm MUST return a structured array of register name/value objects

#### Scenario: Write register
- **WHEN** `register_write` is called with a register name and value
- **THEN** LinkTerm MUST issue a backend register write operation
- **AND** return debug evidence that identifies the written register and value

### Requirement: Memory access
LinkTerm SHALL implement bounded binary memory read and write through the backend.

#### Scenario: Read memory bytes
- **WHEN** `memory_read` is called with an address and length within the schema limit
- **THEN** LinkTerm MUST read the requested memory range through the backend
- **AND** return `dataBase64` whose decoded byte length equals the returned backend buffer length

#### Scenario: Write memory bytes
- **WHEN** `memory_write` is called with base64 data
- **THEN** LinkTerm MUST validate and decode the payload using the existing 16 MiB cap
- **AND** write the resulting bytes through the backend

### Requirement: Breakpoint management
LinkTerm SHALL implement breakpoint set, clear by id, and list using structured per-probe breakpoint state.

#### Scenario: Set breakpoint
- **WHEN** `breakpoint_set` is called with an address and optional kind
- **THEN** LinkTerm MUST set the breakpoint on the target
- **AND** return a `BreakpointSpec` with a stable id for later clear

#### Scenario: Clear breakpoint by id
- **WHEN** `breakpoint_clear` is called with a known breakpoint id
- **THEN** LinkTerm MUST clear that breakpoint from the target or fail without claiming success
- **AND** subsequent `breakpoint_list` MUST NOT include the cleared breakpoint

#### Scenario: List breakpoints
- **WHEN** `breakpoint_list` is called
- **THEN** LinkTerm MUST return the current structured breakpoint list for that probe

### Requirement: RTT channel operations
LinkTerm SHALL implement RTT connect, read, search, and clear without writing RTT output to terminal transcripts.

#### Scenario: Connect RTT
- **WHEN** `rtt_connect` is called for a connected probe and RTT is available
- **THEN** LinkTerm MUST establish backend-owned RTT access
- **AND** return visible channel metadata

#### Scenario: Read RTT data
- **WHEN** `rtt_read` is called with a channel index and `maxBytes`
- **THEN** LinkTerm MUST return at most `maxBytes` of data as base64
- **AND** indicate whether the result was truncated

#### Scenario: Search RTT data
- **WHEN** `rtt_search` is called with a literal pattern
- **THEN** LinkTerm MUST search current RTT buffered data without consuming it
- **AND** return a match offset or null plus a bounded preview

#### Scenario: Clear RTT data
- **WHEN** `rtt_clear` is called
- **THEN** LinkTerm MUST drain or clear that channel's buffered data
- **AND** subsequent reads MUST not replay data that was already cleared

### Requirement: Snapshot and crash diagnosis
LinkTerm SHALL implement snapshot capture and Cortex-M crash diagnosis using structured register and memory evidence.

#### Scenario: Capture snapshot
- **WHEN** `snapshot_capture` is called with memory ranges
- **THEN** LinkTerm MUST return `pc`, `sp`, register values, requested memory snippets, and `capturedAt`
- **AND** MCP evidence MUST base64-encode memory snippets at the MCP boundary

#### Scenario: Diagnose crash
- **WHEN** `crash_diagnose` is called on a Cortex-M target
- **THEN** LinkTerm MUST read relevant CPU and fault registers
- **AND** return a structured `CrashDiagnosis` with fault kind, `pc`, `lr`, `sp`, reason, and stack trace entries when available

#### Scenario: No recognizable fault
- **WHEN** fault registers do not indicate a supported fault or required registers are unavailable
- **THEN** LinkTerm MUST return `fault: "unknown"` with a diagnostic reason
- **AND** MUST NOT return `NOT_IMPLEMENTED`

### Requirement: Flash erase and write completion
LinkTerm SHALL implement flash erase and flash write through the backend while preserving automatic execution, admission, and binary safety.

#### Scenario: Flash erase executes after validation
- **WHEN** `flash_erase` is called with valid input and `confirm` omitted or false
- **THEN** LinkTerm MUST call the backend erase operation after normal admission
- **AND** MUST record the high-impact operation in Activity/Audit evidence

#### Scenario: Flash write validates before execution
- **WHEN** `flash_write` is called with malformed or oversized base64 data
- **THEN** LinkTerm MUST return the normal binary validation error
- **AND** MUST NOT call the backend write operation

#### Scenario: Flash write succeeds after validation
- **WHEN** `flash_write` is called with a target address and valid base64 data
- **THEN** LinkTerm MUST decode the payload using the existing 16 MiB cap
- **AND** write bytes through the backend
- **AND** return debug evidence containing the address and byte count

### Requirement: Test-driven phased delivery
LinkTerm SHALL implement the J-Link backend completion in small phases, each beginning with failing tests.

#### Scenario: Phase starts
- **WHEN** a phase begins implementation
- **THEN** the first code change for that phase MUST add or update a test that fails against the current production backend

#### Scenario: Phase finishes
- **WHEN** a phase implementation is completed
- **THEN** targeted tests for that phase MUST pass
- **AND** the OpenSpec task checklist MUST be updated for completed work
