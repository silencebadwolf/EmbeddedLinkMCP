## MODIFIED Requirements

### Requirement: Debug tool descriptions include safety boundaries

LinkTerm SHALL write debug and workflow MCP tool descriptions so AI clients understand that validated
operations execute automatically, LinkTerm owns backend access, and direct CLI fallback is prohibited.
Descriptions SHALL treat legacy `confirm` input as ignored compatibility metadata rather than human
authorization.

#### Scenario: High-impact tool is described

- **WHEN** an AI client reads the description for a high-impact debug or workflow tool
- **THEN** the description states that the operation executes immediately after existing validation,
  runtime, admission, and resource checks pass
- **AND** it directs the AI to observe Activity/Audit/backend evidence
- **AND** it does not claim that `confirm=true` or human approval is required
- **AND** it does not suggest bypassing LinkTerm with external tools

#### Scenario: Workflow tool is described

- **WHEN** an AI client reads the description for `run_control_workflow`
- **THEN** the description recommends the high-level workflow for supported modes
- **AND** it recommends background jobs and evidence recovery for long operations
- **AND** it warns against retrying hardware operations solely because the host request timed out
- **AND** it does not recommend manually running J-Link, GDB, serial, flash CLI, or VS Code tasks
