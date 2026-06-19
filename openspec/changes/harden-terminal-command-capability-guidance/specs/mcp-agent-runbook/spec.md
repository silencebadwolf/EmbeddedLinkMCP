## MODIFIED Requirements

### Requirement: Initialize-time quick runbook instructions

LinkTerm SHALL include a compact AI operation runbook in MCP initialize instructions so an AI client receives safe operating guidance immediately on connection without requiring the user to manually request a separate manual-reading step.

#### Scenario: Client receives quick guidance on initialize
- **WHEN** an MCP client completes initialization against LinkTerm MCP
- **THEN** the server instructions include LinkTerm MCP Agent Runbook guidance
- **AND** the instructions identify `get_agent_runbook` as the optional detailed/profile-aware guide
- **AND** the instructions describe the LinkTerm ownership boundary, high-impact confirmation rule, preferred high-level workflow, and fresh evidence requirement
- **AND** the instructions identify `write_to_session`, `send_and_wait`, and `read_from_session` as the supported terminal command send/read path

### Requirement: Runbook content structure

The `get_agent_runbook` result SHALL include both human-readable Markdown and machine-readable JSON describing LinkTerm MCP usage.

#### Scenario: Markdown guide is returned
- **WHEN** `get_agent_runbook` succeeds
- **THEN** the structured evidence includes a Markdown field that explains safe AI operation of LinkTerm
- **AND** the Markdown covers terminal/serial, control profile, control workflow, J-Link debug, flash, RTT/GDB, and UI capabilities at workflow level
- **AND** the Markdown states that terminal commands are sent through `write_to_session` or `send_and_wait` and read back through `read_from_session`

## ADDED Requirements

### Requirement: Runtime terminal command capability status

LinkTerm SHALL expose the canonical terminal command send/read tools in the read-only `get_app_status` status snapshot so AI clients can discover command capability from runtime state rather than partial host assumptions.

#### Scenario: Status reports terminal command tools when available
- **WHEN** an MCP client calls `get_app_status` and the core tool set is complete
- **THEN** the status evidence includes `terminalCommandTools.available: true`
- **AND** it names `list_sessions`, `open_session`, `get_session_status`, `write_to_session`, `send_and_wait`, and `read_from_session`
- **AND** it describes that terminal writes go through LinkTerm session tools and the shared write queue

#### Scenario: Status reports missing terminal command tools
- **WHEN** an MCP client calls `get_app_status` and one or more canonical terminal command tools are missing
- **THEN** the status evidence includes `terminalCommandTools.available: false`
- **AND** it lists the missing canonical terminal command tool names
- **AND** the client is not instructed to use external serial tools as a fallback

#### Scenario: Terminal capability status is read-only
- **WHEN** an MCP client calls `get_app_status`
- **THEN** building the terminal command capability status SHALL NOT write to sessions, open sessions, mutate UI state, flash firmware, reset or halt the CPU, start GDB, or write workspace files
