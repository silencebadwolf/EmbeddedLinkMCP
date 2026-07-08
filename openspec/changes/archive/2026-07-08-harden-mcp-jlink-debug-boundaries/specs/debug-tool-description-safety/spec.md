## ADDED Requirements

### Requirement: Debug tool descriptions include safety boundaries
LinkTerm SHALL write debug and workflow MCP tool descriptions so AI clients understand confirmation requirements, backend ownership, and prohibited direct CLI fallback.

#### Scenario: High-impact tool is described
- **WHEN** an AI client reads the description for a high-impact debug or workflow tool
- **THEN** the description states whether `confirm=true` is required
- **AND** the description does not suggest bypassing LinkTerm with external tools

#### Scenario: Workflow tool is described
- **WHEN** an AI client reads the description for `run_control_workflow`
- **THEN** the description recommends the high-level workflow for supported modes
- **AND** it identifies when confirmation is required
- **AND** it does not recommend manually running J-Link, GDB, serial, flash CLI, or VS Code tasks
