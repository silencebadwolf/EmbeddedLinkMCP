# mcp-debug-no-task-fallback Specification

## Purpose

Define the prohibition on MCP debug workflows falling back to VS Code tasks or other external debug launch paths.
## Requirements
### Requirement: Debug workflows do not fall back to VS Code tasks
LinkTerm SHALL NOT use VS Code tasks or task terminal output as a fallback for J-Link, GDB, flash, RTT, or probe operations.

#### Scenario: Backend cannot perform operation
- **WHEN** LinkTerm backend returns `NO_BACKEND`, `NOT_IMPLEMENTED`, `PROBE_NOT_FOUND`, `JLINK_OPERATION_FAILED`, or `INVALID_STATE`
- **THEN** MCP evidence reports the structured failure
- **AND** LinkTerm does not start a VS Code task to perform the hardware operation

#### Scenario: AI client needs next action
- **WHEN** a debug or workflow result includes recommended next actions
- **THEN** recommended tools are LinkTerm MCP tools or user configuration steps
- **AND** recommended actions do not name VS Code J-Link tasks, terminal names, or external flashing commands
