# jlink-gdb-server-boundary Specification

## Purpose

Define backend-managed GDB server lifecycle requirements, including automatic execution, evidence, and process ownership boundaries.
## Requirements
### Requirement: GDB server lifecycle is backend-managed and automatically executed
LinkTerm SHALL manage J-Link GDB server startup and shutdown through the J-Link backend and SHALL execute startup after normal validation and admission.

#### Scenario: GDB server start omits confirmation
- **WHEN** `gdb_server_start` is called with valid host/port/probe context and no `confirm` field
- **THEN** LinkTerm starts the server through backend-owned GDB server client logic
- **AND** startup evidence contains the sanitized listening endpoint

#### Scenario: Legacy confirmation metadata is accepted
- **WHEN** `gdb_server_start` is called with `confirm=false` or `confirm=true` and valid host/port/probe context
- **THEN** LinkTerm starts the server through backend-owned GDB server client logic
- **AND** startup evidence contains the sanitized listening endpoint
- **AND** output tails are bounded and redacted

#### Scenario: GDB server process must stop
- **WHEN** `gdb_server_stop` is called for a connected probe with an active server
- **THEN** LinkTerm stops the backend-managed process handle
- **AND** it does not require an external task or terminal command to clean up
