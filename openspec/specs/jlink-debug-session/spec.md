# jlink-debug-session Specification

## Purpose

Define LinkTerm-managed J-Link debug session behavior, including GDB server lifecycle, workflow preparation, blockers, and debug-output separation.
## Requirements
### Requirement: LinkTerm-managed J-Link GDB server lifecycle

LinkTerm SHALL start and stop SEGGER J-Link GDB server processes only through the J-Link backend layer under `src/jlink/`.

#### Scenario: GDB server starts from a connected probe
- **WHEN** `gdb_server_start` is called with a connected `probeId`, host, port, and timeout
- **THEN** LinkTerm starts the SEGGER GDB server through the backend-owned process runner
- **AND** returns structured debug evidence containing the host, port, probe id, and bounded process output status

#### Scenario: Legacy confirmation metadata is ignored
- **WHEN** `gdb_server_start` is called with valid input and `confirm` omitted or false
- **THEN** LinkTerm starts the GDB server after normal admission
- **AND** Activity/Audit evidence records the operation

#### Scenario: GDB server start timeout is bounded
- **WHEN** the SEGGER GDB server process does not become ready before the requested timeout
- **THEN** LinkTerm terminates the process
- **AND** returns a structured `ABORTED` or `JLINK_OPERATION_FAILED` error with a redacted output preview

### Requirement: Debug session workflow preparation

LinkTerm SHALL provide a high-level debug-session preparation path inside `run_control_workflow` for debug diagnosis without requiring agents to guess low-level tool order.

#### Scenario: Debug diagnosis starts the GDB server
- **WHEN** `run_control_workflow` is called with `mode="debug-diagnose"` and debug evidence requested
- **THEN** LinkTerm loads the control profile, connects the configured probe, starts the GDB server, and records a `gdb_server_start` workflow step
- **AND** subsequent register or memory diagnosis steps use the same probe handle

#### Scenario: Backend without GDB support degrades deterministically
- **WHEN** the backend reports `NOT_IMPLEMENTED` for `gdbServerStart`
- **THEN** `run_control_workflow` records `gdb_server_start` as `skipped`
- **AND** returns a `nextActions` entry explaining that GDB server support must be implemented before full debug-session evidence is available

### Requirement: Debug session preflight blockers

LinkTerm SHALL detect debug-session blockers before agents enter repeated low-level retries.

#### Scenario: Unsupported target blocks debug session
- **WHEN** the configured J-Link target is absent from local SEGGER device databases
- **THEN** LinkTerm returns a `jlink_target_unsupported` blocking reason
- **AND** it does not connect a probe or spawn a GDB server process

#### Scenario: GDB server executable is unavailable
- **WHEN** LinkTerm cannot resolve a trusted absolute path to the SEGGER GDB server executable
- **THEN** `gdb_server_start` fails with structured debug evidence and a remediation hint
- **AND** no fallback to PATH or current-directory executable lookup is attempted

### Requirement: Debug output remains separated from terminal transcript

LinkTerm SHALL keep J-Link debug-session output in debug evidence and SHALL NOT append it to terminal transcript buffers.

#### Scenario: GDB server emits process output
- **WHEN** the managed GDB server writes stdout or stderr
- **THEN** LinkTerm stores a bounded debug output tail for J-Link status and MCP debug evidence
- **AND** terminal session transcript cursors are unchanged
