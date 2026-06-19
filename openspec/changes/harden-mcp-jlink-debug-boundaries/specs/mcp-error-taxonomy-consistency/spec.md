## ADDED Requirements

### Requirement: MCP and J-Link error taxonomies stay synchronized
LinkTerm SHALL keep shared error code constants, MCP tool error union types, and J-Link/domain error translation branches synchronized when introducing or changing hardware-control error classes.

#### Scenario: New hardware-control error is introduced
- **WHEN** implementation adds a new J-Link or workflow domain error code
- **THEN** the shared error-code registry is updated
- **AND** the MCP `ToolErrorCode` union is updated
- **AND** the relevant error translation function maps the domain error to that stable code

#### Scenario: Error taxonomy sync test runs
- **WHEN** unit tests validate error-code consistency
- **THEN** they fail if a J-Link/domain error code lacks a MCP translation
- **AND** they fail if MCP exposes an undocumented hardware-control error code
