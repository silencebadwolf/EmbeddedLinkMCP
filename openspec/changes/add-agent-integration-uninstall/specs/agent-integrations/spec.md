## ADDED Requirements

### Requirement: Agent integration uninstall removes only LinkTerm MCP config
LinkTerm SHALL provide an uninstall action that removes the LinkTerm-managed `linkterm` MCP server entry from a selected external Agent config while preserving unrelated settings.

#### Scenario: Remove LinkTerm from JSON agent config
- **WHEN** a configured JSON-based Agent integration is uninstalled
- **THEN** LinkTerm removes only that config kind's `linkterm` MCP server entry
- **AND** unrelated settings and unrelated MCP servers remain unchanged
- **AND** LinkTerm creates a backup before writing

#### Scenario: Remove LinkTerm from Codex TOML
- **WHEN** a configured Codex TOML integration is uninstalled
- **THEN** LinkTerm removes `[mcp_servers.linkterm]`
- **AND** LinkTerm removes `[mcp_servers.linkterm.env]` when present
- **AND** other TOML tables remain unchanged

#### Scenario: Remove LinkTerm from WSL Codex config
- **WHEN** a WSL Codex integration is uninstalled
- **THEN** LinkTerm reads, backs up, and writes through the WSL config file bridge
- **AND** the Windows cmd.exe stdio fallback path is not used for config removal

### Requirement: Agent integration uninstall is exposed through UI and IPC
LinkTerm SHALL expose uninstall through the same Agent integration surface as install and diagnose.

#### Scenario: User removes a configured integration
- **WHEN** the user clicks remove on a configured Agent integration row
- **THEN** the renderer invokes the uninstall preload API with the row target id
- **AND** the row updates to not configured after the operation succeeds
- **AND** the backup path is displayed when available

### Requirement: Token diagnostics explain environment readiness
LinkTerm SHALL explain `LINKTERM_MCP_TOKEN` diagnostics in user-facing language.

#### Scenario: Token env var is available
- **WHEN** an HTTP MCP integration diagnostic sees the bearer token env var in LinkTerm's current process environment
- **THEN** the diagnostic status is pass
- **AND** the message explains that LinkTerm can see the token and HTTP MCP auth can use it after the Agent process inherits the env var

#### Scenario: Token env var is missing
- **WHEN** an HTTP MCP integration diagnostic cannot see the bearer token env var in LinkTerm's current process environment
- **THEN** the diagnostic status is fail
- **AND** the message tells the user to set the env var and restart LinkTerm/Codex so the Agent can inherit it
