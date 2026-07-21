## ADDED Requirements

### Requirement: Agent integration configuration does not duplicate runtime guidance

LinkTerm-managed external Agent configuration SHALL persist only the MCP connection, launch, and
authentication facts required by the selected client. It SHALL NOT embed a second copy of LinkTerm's
operating guide in client-specific system-prompt fields.

#### Scenario: Stdio integration is installed

- **WHEN** LinkTerm installs a stdio Agent integration
- **THEN** the managed entry contains the required command, arguments, environment, and client-specific
  transport shape
- **AND** it does not contain initialize instructions, runbook Markdown, or a duplicated usage prompt

#### Scenario: HTTP integration is installed

- **WHEN** LinkTerm installs an HTTP Agent integration
- **THEN** the managed entry contains the owner URL and bearer-token environment reference needed by
  the client
- **AND** runtime operating guidance is still supplied by MCP initialize/tool responses
