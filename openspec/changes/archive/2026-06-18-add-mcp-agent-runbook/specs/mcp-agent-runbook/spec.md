## ADDED Requirements

### Requirement: Runtime-generated agent runbook tool

LinkTerm SHALL expose an always-registered read-only MCP tool named `get_agent_runbook` that returns an AI operation runbook generated from packaged runtime code and current non-sensitive runtime state.

#### Scenario: Agent reads the runbook immediately after connection
- **WHEN** an MCP client calls `get_agent_runbook` without a workspace root
- **THEN** LinkTerm returns a successful tool result
- **AND** the result includes a Markdown runbook
- **AND** the result includes structured JSON metadata
- **AND** the content does not depend on reading source-repository documentation files

#### Scenario: Runbook tool is read-only
- **WHEN** an MCP client calls `get_agent_runbook`
- **THEN** LinkTerm SHALL NOT open serial ports, connect probes, flash firmware, erase memory, reset or halt the CPU, start a GDB server, mutate UI state, or write workspace files

### Requirement: Runbook content structure

The `get_agent_runbook` result SHALL include both human-readable Markdown and machine-readable JSON describing LinkTerm MCP usage.

#### Scenario: Markdown guide is returned
- **WHEN** `get_agent_runbook` succeeds
- **THEN** the structured evidence includes a Markdown field that explains safe AI operation of LinkTerm
- **AND** the Markdown covers terminal/serial, control profile, control workflow, J-Link debug, flash, RTT/GDB, and UI capabilities at workflow level

#### Scenario: Structured workflow data is returned
- **WHEN** `get_agent_runbook` succeeds
- **THEN** the structured evidence includes workflow entries with stable identifiers
- **AND** each workflow entry identifies recommended MCP tools, risk level, whether confirmation is required, and expected evidence kind

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
