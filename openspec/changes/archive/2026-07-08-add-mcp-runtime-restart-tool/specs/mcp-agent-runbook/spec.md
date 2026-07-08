## ADDED Requirements

### Requirement: Stale runtime recovery is executable through MCP

When LinkTerm MCP detects that compiled runtime artifacts changed after the process started, it SHALL expose a safe MCP recovery action instead of only textual restart guidance.

#### Scenario: App status recommends the runtime restart tool

- **GIVEN** runtime diagnostics report `code.fresh=false`
- **WHEN** `get_app_status` or `get_agent_runbook` returns recommended next actions
- **THEN** the recommendations SHALL name `restart_mcp_runtime`
- **AND** they SHALL say to call `get_app_status` again after restart before hardware operations

#### Scenario: Normal state-affecting tools remain blocked while stale

- **GIVEN** runtime diagnostics report `code.fresh=false`
- **WHEN** an ordinary state-affecting tool such as `run_control_workflow` or `probe_disconnect` is called
- **THEN** LinkTerm SHALL reject the call before backend invocation
- **AND** the error SHALL include the stale artifact list

#### Scenario: Runtime restart tool can run while stale

- **GIVEN** runtime diagnostics report `code.fresh=false`
- **WHEN** `restart_mcp_runtime` is called with `confirm=true`
- **THEN** LinkTerm SHALL schedule a runtime restart
- **AND** the tool SHALL return structured evidence before the process exits
- **AND** the tool SHALL NOT touch probes, flash, reset, serial sessions, RTT, or GDB

#### Scenario: Runtime restart requires confirmation

- **GIVEN** `restart_mcp_runtime` is called without `confirm=true`
- **WHEN** LinkTerm handles the request
- **THEN** LinkTerm SHALL return `CONFIRMATION_REQUIRED`
- **AND** it SHALL NOT schedule a restart
