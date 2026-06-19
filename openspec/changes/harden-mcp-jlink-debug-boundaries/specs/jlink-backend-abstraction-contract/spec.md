## ADDED Requirements

### Requirement: Backend abstraction is the sole hardware-control boundary
LinkTerm SHALL treat `IJLinkBackend` as the sole boundary for J-Link probe, CPU, memory, register, flash, RTT, GDB, snapshot, and crash-diagnosis operations exposed through MCP.

#### Scenario: MCP debug tool receives request
- **WHEN** a MCP debug tool handles a hardware-control request
- **THEN** it invokes `IJLinkBackend`
- **AND** it does not access SEGGER process runners, Commander script builders, GDB server clients, serial ports, or VS Code tasks directly

#### Scenario: Control workflow performs J-Link step
- **WHEN** `run_control_workflow` performs a J-Link step such as connect, flash, verify, reset, RTT, or diagnose
- **THEN** it invokes `IJLinkBackend` or existing high-level LinkTerm profile/session abstractions
- **AND** it does not directly spawn external hardware tools

### Requirement: Null backend remains an always-registered safe rejection path
LinkTerm SHALL keep debug tools visible when no real backend is available and SHALL reject calls through a structured null-backend error.

#### Scenario: Debug tools are listed without backend
- **WHEN** no real J-Link backend is injected
- **THEN** the debug tool names are still registered
- **AND** calls return `NO_BACKEND`
- **AND** calls do not run external commands
