## ADDED Requirements

### Requirement: MCP tool registration is centralized and auditable
LinkTerm SHALL register MCP tools through the LinkTerm registry wrapper so schema checking, origin enforcement, exception normalization, and tool-name diagnostics remain consistent.

#### Scenario: New MCP tool is added
- **WHEN** a new LinkTerm MCP tool is introduced
- **THEN** it is registered through the registry wrapper
- **AND** it declares sensitivity, input schema, description, and handler
- **AND** it participates in registered tool-name diagnostics where appropriate

#### Scenario: Handler throws unexpected error
- **WHEN** a registered MCP handler throws an unknown error
- **THEN** the registry normalizes it into a structured internal error
- **AND** the result still includes `origin: "ai"` and schema version

### Requirement: Core surfaces remain independently isolated
LinkTerm SHALL keep terminal, workspace/profile, control-workflow, debug, runbook/status, and UI surfaces isolated by responsibility.

#### Scenario: Debug feature requires terminal evidence
- **WHEN** a debug workflow also needs terminal observation
- **THEN** terminal operations use session tools and transcript cursors
- **AND** debug tools do not write debug output into terminal transcripts

#### Scenario: UI state is needed for diagnosis
- **WHEN** AI needs visual UI evidence
- **THEN** it uses UI-specific tools
- **AND** debug or terminal tools do not capture screenshots or mutate UI state
