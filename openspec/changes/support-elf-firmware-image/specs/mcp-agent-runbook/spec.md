# mcp-agent-runbook Specification

## MODIFIED Requirements

### Requirement: Initialize-time quick runbook instructions

LinkTerm SHALL include a compact AI operation runbook in MCP initialize instructions so an AI client receives safe operating guidance immediately on connection without requiring the user to manually request a separate manual-reading step.

#### Scenario: Client receives firmware image guidance on initialize
- **WHEN** an MCP client completes initialization against LinkTerm MCP
- **THEN** the server instructions identify `.bin`, `.hex`, and `.elf` as supported profile firmware formats
- **AND** the instructions say ELF firmware is decoded from loadable segments before raw flash download
- **AND** the instructions say an AI client must not rewrite an `.elf` profile firmware path to `.bin` to bypass diagnostics

### Requirement: Runbook content structure

The `get_agent_runbook` result SHALL include both human-readable Markdown and machine-readable JSON describing LinkTerm MCP usage.

#### Scenario: Runbook explains firmware image ownership
- **WHEN** `get_agent_runbook` succeeds
- **THEN** the Markdown explains that `.bin`, `.hex`, and `.elf` profile firmware paths are supported
- **AND** the Markdown explains that LinkTerm decodes Intel HEX records and ELF loadable program segments before invoking the raw flash backend
- **AND** the Markdown warns that ELF headers are not Cortex-M vector tables
- **AND** the structured safety rules include the same firmware image guidance

### Requirement: Safety and confirmation guidance

The runbook SHALL explicitly describe LinkTerm's ownership boundary and high-impact confirmation requirements.

#### Scenario: Profile-first flash recommendations preserve ELF firmware facts
- **WHEN** `get_app_status` reports a workspace profile that is ready for `profile_flash_observe`
- **THEN** the recommended next actions and recommended workflow reason say to use `profile.flash.binary` without overriding it
- **AND** they identify `.bin`, `.hex`, and `.elf` as supported firmware formats
- **AND** they say not to override an `.elf` profile with a `.bin` path

#### Scenario: Workflow tool description preserves firmware image guidance
- **WHEN** an MCP client lists tools
- **THEN** the `run_control_workflow` description explains `.bin`, `.hex`, and `.elf` firmware handling
- **AND** it says ELF loadable segments are decoded before raw flash download
- **AND** it says not to override an `.elf` profile with a `.bin` path
