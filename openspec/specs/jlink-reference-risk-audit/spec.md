# jlink-reference-risk-audit Specification

## Purpose

Define how reference repository risks are audited before J-Link ideas are translated into LinkTerm-owned implementation.
## Requirements
### Requirement: Reference risk audit is part of implementation readiness
LinkTerm SHALL include a reference-risk check before implementing behavior inspired by no-license J-Link MCP repositories.

#### Scenario: Implementation task begins
- **WHEN** an implementation task cites JLinkMCP as design input
- **THEN** the task identifies which ideas are design-only references
- **AND** the task identifies which code, parameters, scripts, and raw output models are prohibited from copying

#### Scenario: Verification runs before completion
- **WHEN** the implementation is ready to be claimed complete
- **THEN** verification includes a search or review that no JLinkMCP source code was copied into LinkTerm
- **AND** verification includes `pnpm run validate:licenses` when runtime dependencies or third-party references changed
