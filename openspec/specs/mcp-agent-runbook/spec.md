# mcp-agent-runbook Specification

## Purpose

Define LinkTerm's runtime-generated MCP operation runbook for AI clients. This capability lets packaged LinkTerm installations teach AI clients safe workflows, confirmation rules, and sanitized runtime/profile context without relying on source-repository documentation or external skills.
## Requirements
### Requirement: Runtime-generated agent runbook tool

LinkTerm SHALL expose an always-registered read-only MCP tool named `get_agent_runbook` that returns an AI operation runbook generated from packaged runtime code and current non-sensitive runtime state.

#### Scenario: Agent reads detailed runbook on demand
- **WHEN** an MCP client calls `get_agent_runbook` without a workspace root
- **THEN** LinkTerm returns a successful tool result
- **AND** the result includes a Markdown runbook
- **AND** the result includes structured JSON metadata
- **AND** the content does not depend on reading source-repository documentation files

#### Scenario: Runbook tool is read-only
- **WHEN** an MCP client calls `get_agent_runbook`
- **THEN** LinkTerm SHALL NOT open serial ports, connect probes, flash firmware, erase memory, reset or halt the CPU, start a GDB server, mutate UI state, or write workspace files

### Requirement: Initialize-time quick runbook instructions

LinkTerm SHALL include a compact AI operation runbook in MCP initialize instructions so an AI client receives safe operating guidance immediately on connection without requiring the user to manually request a separate manual-reading step.

#### Scenario: Client receives quick guidance on initialize
- **WHEN** an MCP client completes initialization against LinkTerm MCP
- **THEN** the server instructions include LinkTerm MCP Agent Runbook guidance
- **AND** the instructions identify `get_agent_runbook` as the optional detailed/profile-aware guide
- **AND** the instructions describe the LinkTerm ownership boundary, high-impact confirmation rule, preferred high-level workflow, and fresh evidence requirement

#### Scenario: Stdio proxy preserves quick guidance
- **WHEN** an MCP client initializes through the LinkTerm stdio proxy
- **THEN** the proxy instructions include the same compact runbook guidance
- **AND** the proxy does not require the user to tell the AI to call `get_agent_runbook` before safe basic operation

#### Scenario: Client receives firmware image guidance on initialize
- **WHEN** an MCP client completes initialization against LinkTerm MCP
- **THEN** the server instructions identify `.bin`, `.hex`, and `.elf` as supported profile firmware formats
- **AND** the instructions say ELF firmware is decoded from loadable segments before raw flash download
- **AND** the instructions say an AI client must not rewrite an `.elf` profile firmware path to `.bin` to bypass diagnostics

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

#### Scenario: Runbook explains firmware image ownership
- **WHEN** `get_agent_runbook` succeeds
- **THEN** the Markdown explains that `.bin`, `.hex`, and `.elf` profile firmware paths are supported
- **AND** the Markdown explains that LinkTerm decodes Intel HEX records and ELF loadable program segments before invoking the raw flash backend
- **AND** the Markdown warns that ELF headers are not Cortex-M vector tables
- **AND** the structured safety rules include the same firmware image guidance

### Requirement: Safety and confirmation guidance

The runbook SHALL explicitly describe LinkTerm's ownership boundary and high-impact confirmation requirements.

#### Scenario: Direct CLI fallback is prohibited
- **WHEN** an AI reads the runbook
- **THEN** the runbook states that AI clients MUST NOT bypass LinkTerm by directly invoking J-Link executables, GDB, ad-hoc serial CLI tools, or VS Code J-Link tasks

#### Scenario: High-impact operations require confirmation
- **WHEN** an AI reads the runbook
- **THEN** the structured JSON identifies high-impact tools that require `confirm: true`
- **AND** the list includes `flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, and `gdb_server_start`
- **AND** the runbook describes that missing confirmation returns `CONFIRMATION_REQUIRED` without invoking the backend

#### Scenario: High-level workflow confirmation is described
- **WHEN** an AI reads the runbook
- **THEN** the runbook identifies high-impact `run_control_workflow` modes that require confirmation
- **AND** the runbook directs clients to prefer supported high-level workflows over manually chaining low-level serial and J-Link tools

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

### Requirement: Sanitized runtime and profile summary

The runbook SHALL include only non-sensitive runtime and control-profile facts needed for AI operation.

#### Scenario: No workspace root is provided
- **WHEN** `get_agent_runbook` is called without `root`
- **THEN** LinkTerm returns general guidance
- **AND** the structured profile summary indicates that no workspace root was provided
- **AND** the tool still succeeds

#### Scenario: Control profile is summarized
- **WHEN** `get_agent_runbook` is called with a valid workspace root containing a control profile
- **THEN** the structured JSON summarizes configured serial, J-Link, flash, and RTT sections using whitelisted non-sensitive fields
- **AND** the summary indicates whether key sections are configured
- **AND** the summary avoids echoing unnecessary absolute firmware paths

#### Scenario: Sensitive data is not leaked
- **WHEN** runtime metadata or control-profile state contains credentials, tokens, private keys, passphrases, J-Link serial numbers, or unknown fields
- **THEN** `get_agent_runbook` SHALL NOT include those values in Markdown or structured JSON

### Requirement: Evidence and versioning contract

The runbook tool SHALL return a normal LinkTerm MCP tool result that follows existing origin, schema version, and evidence conventions.

#### Scenario: Successful runbook evidence
- **WHEN** `get_agent_runbook` succeeds
- **THEN** the result has `origin: "ai"`
- **AND** the result includes the current LinkTerm MCP schema version
- **AND** the evidence kind is `agent_runbook`
- **AND** the evidence cursor is `0`

#### Scenario: Client schema mismatch for read-only tool
- **WHEN** `get_agent_runbook` is called with a mismatched client schema version
- **THEN** LinkTerm follows the existing read-only version mismatch policy
- **AND** the warning is attached to the runbook evidence metadata when the call is allowed

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
