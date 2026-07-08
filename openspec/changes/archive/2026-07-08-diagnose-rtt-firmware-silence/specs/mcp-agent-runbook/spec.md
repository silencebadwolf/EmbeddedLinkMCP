## MODIFIED Requirements

### Requirement: Runbook content structure

The `get_agent_runbook` result SHALL include both human-readable Markdown and machine-readable JSON describing LinkTerm MCP usage.

#### Scenario: Markdown guide is returned
- **WHEN** `get_agent_runbook` succeeds
- **THEN** the structured evidence includes a Markdown field that explains safe AI operation of LinkTerm
- **AND** the Markdown covers terminal/serial, control profile, control workflow, J-Link debug, flash, RTT/GDB, and UI capabilities at workflow level
- **AND** the Markdown directs agents diagnosing silent RTT logs to use `diagnose_rtt_log_session` before considering flash, reset, or external-tool recovery

#### Scenario: Structured workflow data is returned
- **WHEN** `get_agent_runbook` succeeds
- **THEN** the structured evidence includes workflow entries with stable identifiers
- **AND** each workflow entry identifies recommended MCP tools, risk level, whether confirmation is required, and expected evidence kind
- **AND** the RTT observation workflow includes `diagnose_rtt_log_session` alongside `open_rtt_log_session` and `read_from_session`
