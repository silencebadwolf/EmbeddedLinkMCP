## ADDED Requirements

### Requirement: Control workflows prefer high-level LinkTerm orchestration
LinkTerm SHALL direct AI clients to use `run_control_workflow` for supported flash/observe/debug workflows instead of manually chaining low-level serial and J-Link tools or invoking external commands.

#### Scenario: Supported workflow exists
- **WHEN** an AI client needs to flash, observe, or diagnose a target using a complete control profile
- **THEN** LinkTerm guidance recommends `run_control_workflow` before low-level tool chaining
- **AND** it does not recommend direct J-Link, GDB, serial CLI, flash CLI, or VS Code task fallback

#### Scenario: Workflow is unsupported or blocked
- **WHEN** `run_control_workflow` cannot proceed because required profile facts, backend capability, or confirmation is missing
- **THEN** LinkTerm returns structured blocking reasons or next actions
- **AND** it does not instruct the AI client to bypass LinkTerm with external hardware tools

### Requirement: Workflow evidence keeps terminal and debug outputs separated
LinkTerm SHALL keep control workflow evidence structured by step and evidence kind, without mixing J-Link debug output into terminal transcripts.

#### Scenario: Workflow performs serial observation and J-Link operations
- **WHEN** a workflow opens or reuses a serial session and also performs J-Link operations
- **THEN** terminal output remains terminal evidence tied to the session cursor
- **AND** J-Link operation results remain debug or workflow evidence
- **AND** debug/probe output is not appended to terminal transcripts as device output
