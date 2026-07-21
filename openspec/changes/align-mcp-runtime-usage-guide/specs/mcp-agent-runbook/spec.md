## MODIFIED Requirements

### Requirement: Initialize-time quick runbook instructions

LinkTerm SHALL include a compact AI operation runbook in MCP initialize instructions so an AI client
receives truthful operating guidance immediately on connection without requiring the user to request
a separate manual-reading step.

#### Scenario: Client receives quick guidance on initialize

- **WHEN** an MCP client completes initialization against LinkTerm MCP
- **THEN** the server instructions include LinkTerm MCP Agent Runbook guidance
- **AND** the instructions identify `get_app_status` as the read-only current-state entry and
  `get_agent_runbook` as the optional detailed/profile-aware guide
- **AND** the instructions describe Main-owned serial create-or-reuse, shared human/AI terminal
  ownership, automatic validated execution, background job recovery, and fresh evidence requirements
- **AND** the instructions identify `write_to_session`, `send_and_wait`, and `read_from_session` as
  the supported terminal command send/read path
- **AND** the instructions do not contain approval, pause, resume-AI, or take-over actions

#### Scenario: Stdio proxy preserves quick guidance

- **WHEN** an MCP client initializes through the LinkTerm stdio proxy
- **THEN** the proxy instructions include the same core operating semantics as the direct server
- **AND** the proxy does not require the user to tell the AI to call `get_agent_runbook` before safe
  basic operation

#### Scenario: Client receives firmware image guidance on initialize

- **WHEN** an MCP client completes initialization against LinkTerm MCP
- **THEN** the server instructions identify `.bin`, `.hex`, and `.elf` as supported profile firmware
  formats
- **AND** the instructions say ELF firmware is decoded from loadable segments before raw flash download
- **AND** the instructions say an AI client must not rewrite an `.elf` profile firmware path to `.bin`
  to bypass diagnostics

### Requirement: Runbook content structure

The `get_agent_runbook` result SHALL include both human-readable Markdown and machine-readable JSON
describing the same LinkTerm MCP operating model.

#### Scenario: Markdown guide is returned

- **WHEN** `get_agent_runbook` succeeds
- **THEN** the structured evidence includes a Markdown field that explains safe AI operation of LinkTerm
- **AND** the Markdown covers startup, terminal/serial, simple-session versus workspace/profile use,
  control workflow, J-Link debug, flash, RTT/GDB, Activity/Audit, and UI capabilities at workflow level
- **AND** the Markdown describes serial create-or-reuse, conditional discovery, shared-session closure,
  bounded settle observations, and no automatic retries
- **AND** the Markdown directs agents diagnosing silent RTT logs to use
  `diagnose_rtt_log_session` before considering flash, reset, or external-tool recovery

#### Scenario: Structured workflow data is returned

- **WHEN** `get_agent_runbook` succeeds
- **THEN** the structured evidence includes workflow entries with stable identifiers
- **AND** each workflow entry identifies recommended MCP tools, risk level, whether execution is
  automatic, and expected evidence kind
- **AND** serial workflow ordering places existing-session inspection before conditional discovery and
  `open_session`
- **AND** the RTT observation workflow includes `diagnose_rtt_log_session` alongside
  `open_rtt_log_session` and `read_from_session`

#### Scenario: Runbook explains firmware image ownership

- **WHEN** `get_agent_runbook` succeeds
- **THEN** the Markdown explains that `.bin`, `.hex`, and `.elf` profile firmware paths are supported
- **AND** the Markdown explains that LinkTerm decodes Intel HEX records and ELF loadable program
  segments before invoking the raw flash backend
- **AND** the Markdown warns that ELF headers are not Cortex-M vector tables
- **AND** the structured safety rules include the same firmware image guidance

### Requirement: Safety and confirmation guidance

The runbook SHALL explicitly describe LinkTerm's ownership boundary and automatic-execution policy.
It SHALL say that legacy `confirm` values are compatibility metadata, not a human approval gate.

#### Scenario: Direct CLI fallback is prohibited

- **WHEN** an AI reads the runbook
- **THEN** the runbook states that AI clients MUST NOT bypass LinkTerm by directly invoking J-Link
  executables, GDB, ad-hoc serial CLI tools, or VS Code J-Link tasks

#### Scenario: High-impact operations execute after validation

- **WHEN** an AI reads the runbook
- **THEN** the structured JSON identifies high-impact tools as automatic after existing checks pass
- **AND** the list includes `flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, and
  `gdb_server_start`
- **AND** the runbook says Activity/Audit/backend evidence must be observed
- **AND** it does not present `confirm=true` or human approval as authorization

#### Scenario: High-level workflow execution is described

- **WHEN** an AI reads the runbook
- **THEN** the runbook identifies high-impact `run_control_workflow` modes as automatic after validation
- **AND** the runbook directs clients to prefer supported high-level/background workflows over manually
  chaining low-level serial and J-Link tools

#### Scenario: Profile-first flash recommendations preserve ELF firmware facts

- **WHEN** `get_app_status` reports a workspace profile that is ready for `profile_flash_observe`
- **THEN** the recommended next actions and recommended workflow reason say to use
  `profile.flash.binary` without overriding it
- **AND** they identify `.bin`, `.hex`, and `.elf` as supported firmware formats
- **AND** they say not to override an `.elf` profile with a `.bin` path

#### Scenario: Workflow tool description preserves firmware image guidance

- **WHEN** an MCP client lists tools
- **THEN** the `run_control_workflow` description explains `.bin`, `.hex`, and `.elf` firmware handling
- **AND** it says ELF loadable segments are decoded before raw flash download
- **AND** it says not to override an `.elf` profile with a `.bin` path

### Requirement: App status guides startup health checks

LinkTerm SHALL document and expose `get_app_status` as the preferred read-only startup status snapshot
before dependent terminal, profile, debug, flash, RTT, GDB, or UI workflows. The guide SHALL state
that status may perform one-shot serial-port and visible-probe discovery but does not connect to or
mutate hardware.

#### Scenario: AI reads initialize guidance

- **WHEN** an MCP client receives LinkTerm initialize instructions
- **THEN** the guidance identifies `get_app_status` as the preferred lightweight status call
- **AND** the guidance does not require screenshot capture for startup health
- **AND** it distinguishes read-only discovery from probe connection, flash, reset, halt, GDB startup,
  terminal writes, or UI mutation
- **AND** it does not suggest direct J-Link, GDB, flash, serial CLI, or VS Code task fallback

#### Scenario: AI reads detailed runbook

- **WHEN** an MCP client calls `get_agent_runbook`
- **THEN** the runbook describes when to use `get_app_status`
- **AND** the runbook explains its read-only discovery and sanitized status boundaries

### Requirement: Background workflow job guidance

The LinkTerm MCP runbook SHALL guide AI clients to use background control workflow jobs for
long-running flash, observe, and debug workflows that may exceed a host tool-call deadline.

#### Scenario: Runbook recommends background jobs for long flash workflows

- **WHEN** an AI reads the runbook
- **THEN** the runbook identifies background control workflow jobs as the preferred path for
  long-running `run_control_workflow` flash or flash-observe-diagnose operations
- **AND** the runbook instructs clients to poll job status and read job evidence instead of retrying
  the hardware operation or using external J-Link, GDB, serial, or VS Code task tools

#### Scenario: Runbook describes job recovery after request timeout

- **WHEN** an AI reads the runbook
- **THEN** the runbook explains that a background job continues inside LinkTerm after its creation
  response and independently of later client polling
- **AND** the runbook names the status, evidence-read, cancellation, and cleanup tools used to recover
  or manage the job
- **AND** it says a host timeout is not proof that the operation failed or permission to repeat flash,
  erase, reset, attach, or GDB startup
- **AND** fresh evidence must come from LinkTerm MCP job/session/debug results

#### Scenario: Initialize instructions mention background mode briefly

- **WHEN** an MCP client completes initialization against LinkTerm MCP
- **THEN** the compact initialize instructions mention that long-running hardware workflows should use
  background job mode when available
- **AND** the instructions continue to describe automatic execution, LinkTerm ownership, and fresh
  evidence requirements
