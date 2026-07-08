# debug-evidence-kind-isolation Specification

## Purpose

Define evidence-kind separation between debug, terminal, workflow, app-status, and UI results so clients do not confuse hardware evidence with terminal transcripts or screenshots.
## Requirements
### Requirement: Debug, terminal, workflow, and UI evidence kinds remain isolated
LinkTerm SHALL keep evidence kinds separated so AI clients can distinguish terminal transcript data, debug probe output, high-level workflow summaries, runbook/status, and UI screenshots.

#### Scenario: Debug tool returns data
- **WHEN** a debug MCP tool succeeds
- **THEN** evidence kind is debug-specific
- **AND** the data is not appended to terminal transcripts

#### Scenario: Workflow returns composite result
- **WHEN** `run_control_workflow` returns a result involving serial and J-Link steps
- **THEN** the workflow evidence identifies each step and its evidence kind
- **AND** serial output remains tied to transcript cursor while debug output remains separate

#### Scenario: UI screenshot is captured
- **WHEN** `ui_screenshot` is used for visual evidence
- **THEN** screenshot evidence remains UI-specific
- **AND** it is not used as a required startup health signal
