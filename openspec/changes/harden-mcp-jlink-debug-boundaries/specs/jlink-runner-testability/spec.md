## ADDED Requirements

### Requirement: J-Link runner behavior is testable without hardware
LinkTerm SHALL test J-Link runner and backend boundary behavior with fake process runners, fake backends, temporary files, and deterministic output samples instead of requiring physical J-Link probes.

#### Scenario: Runner path policy is tested
- **WHEN** tests exercise executable path resolution and rejection
- **THEN** they use temporary fake executable files and relative-path inputs
- **AND** they do not invoke real SEGGER executables

#### Scenario: Runner output policy is tested
- **WHEN** tests exercise SEGGER output classification and redaction
- **THEN** they feed deterministic stdout/stderr samples through fake runners
- **AND** they assert bounded redacted diagnostics and domain errors

#### Scenario: MCP boundary policy is tested
- **WHEN** tests exercise debug MCP tools
- **THEN** they use fake `IJLinkBackend` implementations
- **AND** they assert backend ledger calls rather than real hardware effects
