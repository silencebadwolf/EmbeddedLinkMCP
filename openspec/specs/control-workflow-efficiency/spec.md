# control-workflow-efficiency Specification

## Purpose

Define deterministic failure classification, safe J-Link speed selection, and machine-readable next actions for high-level control workflows.
## Requirements
### Requirement: Workflow failure classification

`run_control_workflow` SHALL classify known workflow failures with stable workflow-local failure codes in its structured evidence.

#### Scenario: RAM preserve failure is classified
- **WHEN** SEGGER output from a flash step includes a target RAM preserve or programming preparation failure
- **THEN** `run_control_workflow` evidence includes failure code `flash_ram_preserve_failed`
- **AND** the failed step remains `flash`
- **AND** the original sanitized error evidence remains available for debugging

#### Scenario: Unknown J-Link failure is classified generically
- **WHEN** a J-Link operation fails with output that does not match a known classifier
- **THEN** `run_control_workflow` evidence includes failure code `jlink_operation_failed`
- **AND** LinkTerm does not invent target, probe, serial, or firmware facts

### Requirement: Machine-readable next actions

`run_control_workflow` SHALL return next actions with enough structure for an AI client to choose the next LinkTerm MCP call without searching or using direct CLI fallback.

#### Scenario: Safe speed retry is recommended
- **WHEN** a flash failure is classified as `flash_ram_preserve_failed`
- **THEN** `nextActions` includes an action with `kind: "retry"`
- **AND** the action includes tool `run_control_workflow`
- **AND** the action includes a machine-readable argument patch recommending safe J-Link speed or profile update
- **AND** the action indicates whether confirmation is required

#### Scenario: Unimplemented capability is not retried blindly
- **WHEN** a workflow step fails or is skipped because the backend capability is not implemented
- **THEN** `nextActions` includes an action with `kind: "stop"` or `kind: "user_action"`
- **AND** the action identifies the unavailable tool or capability
- **AND** the action does not recommend repeatedly calling the same unavailable operation

### Requirement: Fast path guidance for AI clients

The high-level control workflow tool description SHALL instruct AI clients to prefer `run_control_workflow` for hardware operations that match its modes.

#### Scenario: Tool description discourages low-level probing first
- **WHEN** an AI client lists or reads the `run_control_workflow` tool description
- **THEN** the description states that clients should prefer this high-level workflow over manually chaining low-level serial and J-Link tools for supported modes
- **AND** the description does not suggest direct J-Link, GDB, serial CLI, or VS Code task fallback
