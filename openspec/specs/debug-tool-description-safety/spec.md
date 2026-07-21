# debug-tool-description-safety Specification

## Purpose

Define safety guidance that must be visible in debug tool descriptions, including automatic execution, evidence observation, and no external CLI fallback.
## Requirements
### Requirement: Debug tool descriptions include safety boundaries
LinkTerm SHALL write debug and workflow MCP tool descriptions so AI clients understand automatic execution, backend ownership, evidence requirements, and prohibited direct CLI fallback.

#### Scenario: High-impact tool is described
- **WHEN** an AI client reads the description for a high-impact debug or workflow tool
- **THEN** the description states that validated high-impact operations execute immediately
- **AND** it does not present `confirm=true` or human approval as authorization
- **AND** the description does not suggest bypassing LinkTerm with external tools

#### Scenario: Workflow tool is described
- **WHEN** an AI client reads the description for `run_control_workflow`
- **THEN** the description recommends the high-level workflow for supported modes
- **AND** it identifies high-impact modes and their Activity/Audit evidence
- **AND** it does not recommend manually running J-Link, GDB, serial, flash CLI, or VS Code tasks
