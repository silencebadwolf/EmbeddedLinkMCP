## ADDED Requirements

### Requirement: J-Link runner arguments preserve safe provenance
LinkTerm SHALL construct J-Link Commander and GDB server arguments from validated backend request fields and non-sensitive profile facts, preserving enough provenance for diagnostics without leaking sensitive data.

#### Scenario: Runner receives validated probe context
- **WHEN** backend code starts a Commander or GDB server operation
- **THEN** the runner receives target, interface, speed, and optional non-sensitive context from the connected probe/profile/request
- **AND** it does not fill missing fields from no-license reference examples

#### Scenario: Diagnostics report argument provenance
- **WHEN** an operation fails due to missing or invalid target, interface, speed, address, firmware, or port values
- **THEN** diagnostics identify the missing or invalid field
- **AND** diagnostics do not expose credentials, private keys, tokens, or J-Link serial numbers
