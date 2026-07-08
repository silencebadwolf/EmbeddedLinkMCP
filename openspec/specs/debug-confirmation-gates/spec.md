# debug-confirmation-gates Specification

## Purpose

Define centrally testable confirmation gates for debug and flash operations that can affect hardware or expose external debug services.
## Requirements
### Requirement: Confirmation gates are centrally testable
LinkTerm SHALL make high-impact debug confirmation behavior testable at the MCP boundary and backend call ledger boundary.

#### Scenario: High-impact tool lacks confirmation
- **WHEN** `flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, or `gdb_server_start` is called without `confirm=true`
- **THEN** LinkTerm returns `CONFIRMATION_REQUIRED`
- **AND** fake backend call ledgers show no corresponding backend invocation

#### Scenario: Binary high-impact tool lacks confirmation
- **WHEN** `flash_download` or `flash_write` receives an oversized or malformed base64 payload without `confirm=true`
- **THEN** LinkTerm returns `CONFIRMATION_REQUIRED`
- **AND** it does not decode the payload
- **AND** it does not return `BUFFER_TOO_LARGE` or base64 parse details before confirmation

#### Scenario: High-impact tool is confirmed
- **WHEN** a high-impact tool receives `confirm=true` and valid input
- **THEN** LinkTerm may call the backend through `IJLinkBackend`
- **AND** any backend failure is translated through the normal J-Link error taxonomy
