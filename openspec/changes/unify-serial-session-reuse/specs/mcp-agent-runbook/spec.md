## ADDED Requirements

### Requirement: Serial observation guidance is reuse-first

The LinkTerm MCP runbook SHALL direct AI clients to inspect managed sessions before requesting a
serial open, while stating that Main-owned session coordination remains authoritative under races.

#### Scenario: AI prepares to observe serial output

- **WHEN** an AI reads the serial observation workflow
- **THEN** the recommended tools name `list_sessions` before `open_session`
- **AND** the guidance says to reuse a compatible active serial session
- **AND** it does not suggest external serial tools as a fallback

#### Scenario: AI still requests an equivalent open

- **GIVEN** an equivalent serial session already exists
- **WHEN** AI calls `open_session` without first listing sessions
- **THEN** Main-owned coordination still returns the existing managed session
- **AND** correctness does not depend on prompt compliance
