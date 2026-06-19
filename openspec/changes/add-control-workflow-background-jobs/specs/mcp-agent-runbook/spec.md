## ADDED Requirements

### Requirement: Background workflow job guidance
The LinkTerm MCP runbook SHALL guide AI clients to use background control workflow jobs for long-running flash, observe, and debug workflows that may exceed a host tool-call deadline.

#### Scenario: Runbook recommends background jobs for long flash workflows
- **WHEN** an AI reads the runbook
- **THEN** the runbook identifies background control workflow jobs as the preferred path for long-running `run_control_workflow` flash or flash-observe-diagnose operations
- **AND** the runbook instructs clients to poll job status and read job evidence instead of retrying the hardware operation or using external J-Link, GDB, serial, or VS Code task tools

#### Scenario: Runbook describes job recovery after request timeout
- **WHEN** an AI reads the runbook
- **THEN** the runbook explains that a background job continues inside LinkTerm after the initiating MCP request returns
- **AND** the runbook names the status, evidence-read, cancellation, and cleanup tools used to recover or manage the job
- **AND** the runbook states that fresh evidence must come from LinkTerm MCP job/session/debug results

#### Scenario: Initialize instructions mention background mode briefly
- **WHEN** an MCP client completes initialization against LinkTerm MCP
- **THEN** the compact initialize instructions mention that long-running hardware workflows should use background job mode when available
- **AND** the instructions continue to describe the high-impact confirmation rule and LinkTerm ownership boundary
