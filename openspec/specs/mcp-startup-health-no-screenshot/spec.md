# mcp-startup-health-no-screenshot Specification

## Purpose

Define startup-health guidance that uses read-only runtime status instead of UI screenshots or hardware-touching probes.
## Requirements
### Requirement: Startup health does not require UI screenshots
LinkTerm SHALL provide non-visual MCP startup health evidence so AI clients do not use screenshot capture as a substitute for runtime, tool-set, or backend status.

#### Scenario: AI needs startup health
- **WHEN** an AI client needs to know whether LinkTerm MCP is usable
- **THEN** it can call a read-only status or runbook tool
- **AND** it does not need to call `ui_screenshot`

#### Scenario: Screenshot is unavailable
- **WHEN** no active BrowserWindow is available
- **THEN** startup health status can still succeed with UI availability marked false
- **AND** LinkTerm does not treat screenshot failure as MCP runtime failure
