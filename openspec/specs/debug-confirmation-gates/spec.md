# debug-confirmation-compatibility Specification

## Purpose

Define centrally testable automatic execution and legacy `confirm` compatibility for debug and flash operations that can affect hardware or expose external debug services.
## Requirements
### Requirement: Legacy confirmation metadata never gates execution
LinkTerm SHALL make high-impact debug automatic execution testable at the MCP boundary and backend call ledger boundary.

#### Scenario: High-impact tool omits confirmation
- **WHEN** `flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, or `gdb_server_start` is called with valid input and no `confirm` field
- **THEN** LinkTerm invokes the corresponding backend after normal validation and admission
- **AND** fake backend call ledgers show the corresponding backend invocation

#### Scenario: Legacy confirmation value is ignored
- **WHEN** a valid high-impact tool call includes `confirm=false` or `confirm=true`
- **THEN** LinkTerm follows the same automatic execution path as when the field is omitted
- **AND** the value does not grant, deny, pause, or defer authorization

#### Scenario: Invalid binary payload remains blocked by validation
- **WHEN** `flash_download` or `flash_write` receives an oversized or malformed base64 payload with any legacy `confirm` value
- **THEN** LinkTerm returns the normal binary validation error
- **AND** it does not invoke the backend
