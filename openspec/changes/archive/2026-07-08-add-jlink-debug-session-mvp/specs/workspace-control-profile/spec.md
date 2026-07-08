## ADDED Requirements

### Requirement: Control workflow debug-session reuse

LinkTerm SHALL reuse workspace control profile J-Link fields when preparing a debug session through `run_control_workflow`.

#### Scenario: Debug workflow uses saved J-Link profile
- **WHEN** `run_control_workflow` is called with `mode="debug-diagnose"` for a workspace with a complete control profile
- **THEN** LinkTerm uses the saved `jlink.target`, `jlink.interface`, and `jlink.speedKHz` fields to connect the probe and prepare debug evidence
- **AND** it does not ask the agent to rediscover those values through low-level tools

#### Scenario: Debug workflow reports missing J-Link profile
- **WHEN** `run_control_workflow` is called with `mode="debug-diagnose"` and the control profile lacks required J-Link fields
- **THEN** LinkTerm returns `INVALID_ARGUMENT` with a message identifying the missing J-Link profile requirement
- **AND** it does not spawn any J-Link or GDB process

### Requirement: Debug workflow structured next actions

LinkTerm SHALL return structured `nextActions` for debug-session blockers discovered from the workspace profile or local toolchain state.

#### Scenario: Debug executable is missing
- **WHEN** the workspace profile is complete but the local SEGGER GDB server executable is unavailable
- **THEN** `run_control_workflow` returns a blocking reason or failed step with `JLINK_OPERATION_FAILED`
- **AND** `nextActions` tells the user to install SEGGER J-Link or configure the trusted executable path

#### Scenario: Debug server feature is not implemented
- **WHEN** the active backend does not implement GDB server startup
- **THEN** `run_control_workflow` returns a skipped `gdb_server_start` step
- **AND** `nextActions` identifies the missing backend feature instead of causing repeated tool retries
