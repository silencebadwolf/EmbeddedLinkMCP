## ADDED Requirements

### Requirement: App status guides startup health checks
LinkTerm SHALL document and expose `get_app_status` as the preferred lightweight startup health check before AI clients perform dependent terminal, profile, debug, flash, RTT, GDB, or UI workflows.

#### Scenario: AI reads initialize guidance
- **WHEN** an MCP client receives LinkTerm initialize instructions
- **THEN** the guidance identifies `get_app_status` as a lightweight health-check option
- **AND** the guidance does not require screenshot capture for startup health
- **AND** the guidance does not suggest direct J-Link, GDB, flash, serial CLI, or VS Code task fallback

#### Scenario: AI reads detailed runbook
- **WHEN** an MCP client calls `get_agent_runbook`
- **THEN** the runbook describes when to use `get_app_status`
- **AND** the runbook explains that status is read-only and does not touch hardware

### Requirement: Runbook includes core tool integrity guidance
LinkTerm SHALL explain core MCP tool-set diagnostics in runbook/status output so AI clients can distinguish missing LinkTerm capabilities from hardware failures.

#### Scenario: Tool set is complete
- **WHEN** `get_app_status` returns a complete core tool set
- **THEN** the evidence includes the expected core tool list, a complete flag, missing tool list, count, and hash
- **AND** the runbook treats LinkTerm MCP as the authoritative route for terminal, UI, profile, workflow, and debug operations

#### Scenario: Tool set is incomplete
- **WHEN** `get_app_status` reports missing core tools
- **THEN** the recommended next action is to repair or restart the LinkTerm MCP runtime
- **AND** the recommended next action is not to run external J-Link, GDB, flash, serial, or VS Code task commands

### Requirement: Runbook records safe use of reference designs
LinkTerm SHALL describe open-source J-Link MCP references as design references only when their license or architecture is incompatible with direct reuse.

#### Scenario: Runbook mentions reference-derived concepts
- **WHEN** generated guidance mentions Commander script orchestration or transport selection as a design concept
- **THEN** it states that actual hardware operations must remain inside LinkTerm MCP tools and backend abstractions
- **AND** it does not include copied reference source code, command scripts, hardcoded target defaults, or raw output parsing instructions
