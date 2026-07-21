## ADDED Requirements

### Requirement: Runtime guidance is layered and packaged

LinkTerm SHALL provide one coherent MCP operating guide through compact initialize instructions,
the detailed `get_agent_runbook` result, machine-readable workflow metadata, and tool descriptions.
The guide SHALL be generated from packaged runtime code and SHALL NOT require an Agent integration
file or repository checkout to carry a duplicate system prompt.

#### Scenario: Client initializes through the direct server

- **WHEN** an MCP client initializes against the Main-owned direct server
- **THEN** it receives the compact operating guide in server instructions
- **AND** the guide names `get_app_status` and `get_agent_runbook` as read-only starting points

#### Scenario: Client initializes through the stdio proxy

- **WHEN** an MCP client initializes through the LinkTerm stdio proxy
- **THEN** it receives the same core operating semantics as the direct server
- **AND** forwarding to the owner runtime does not replace the packaged guide with client-specific text

#### Scenario: Client lists tools

- **WHEN** an MCP client calls `tools/list`
- **THEN** key terminal, profile, workflow, RTT, and debug descriptions agree with the initialize and
  detailed runbook semantics

### Requirement: Serial guidance is create-or-reuse first

The guide SHALL direct AI clients to inspect Main-owned sessions before requesting a serial open.
It SHALL describe serial `open_session` as create-or-reuse and SHALL keep Main-owned coordination,
not prompt compliance, authoritative.

#### Scenario: Compatible active serial session exists

- **WHEN** `list_sessions` or `get_app_status` reports a compatible active serial session
- **THEN** the guide directs the AI to use that `sessionId`
- **AND** it explains that a serial `open_session` request may return the same identifier with
  `evidence.data.reused=true`

#### Scenario: No known serial configuration exists

- **WHEN** there is no compatible active session, workspace/control-profile serial fact, or explicit
  user-provided serial configuration
- **THEN** the guide presents `discover_serial_ports` as a conditional one-shot discovery tool
- **AND** it does not present port enumeration as a mandatory step when configuration is already known

#### Scenario: Serial configuration conflicts

- **WHEN** `open_session` returns `SERIAL_SESSION_CONFLICT`
- **THEN** the guide directs the AI to inspect the existing session and compare configuration
- **AND** it forbids a blind retry loop or creation of another same-port session

### Requirement: Shared terminal ownership is explicit

The guide SHALL explain that human and AI writes for one session use the same `SessionManager`,
`WriteQueue`, transport, and transcript. It SHALL preserve simultaneous operation without approval,
pause, take-over, focus seizure, or an origin-based mutex.

#### Scenario: Human and AI use the same terminal

- **WHEN** an AI reuses a human-opened terminal or a human opens an AI-created terminal
- **THEN** the guide says both parties observe the same transcript and may submit input
- **AND** it says AI activity must not disable human keyboard input or claim exclusive ownership

#### Scenario: AI considers closing a shared session

- **WHEN** a session may still be in use by the visible App or user
- **THEN** the `close_session` description warns that closing the transport affects both parties
- **AND** the guide directs the AI to close it only when the user requested closure or the workflow
  explicitly owns disposal

### Requirement: Terminal send and read semantics are truthful

The guide SHALL describe `write_to_session` and `send_and_wait` as host-side writes through the shared
queue, and `read_from_session` as cursor-based transcript evidence. It SHALL distinguish host
acceptance from device execution.

#### Scenario: AI uses send_and_wait

- **WHEN** the AI calls `send_and_wait`
- **THEN** the guide says LinkTerm writes once, waits the bounded settle interval, and returns
  device-origin bytes observed during that interval
- **AND** completion markers are described as result metadata rather than a success gate
- **AND** the guide says the tool does not resend automatically

#### Scenario: Settle window contains no output

- **WHEN** `send_and_wait` returns `success=true`, `reason=settled`, and `hasDeviceOutput=false`
- **THEN** the guide says the empty window does not prove a crash or successful command completion
- **AND** it directs the AI to inspect the transcript/context before choosing a next command
- **AND** it forbids automatically repeating a state-affecting command

#### Scenario: Write result reports bytesWritten

- **WHEN** a terminal or RTT write returns `bytesWritten`
- **THEN** the guide treats it as host-side acceptance into LinkTerm's write path
- **AND** device-origin output or backend evidence is required before claiming device consumption or
  command success

### Requirement: Recovery guidance avoids duplicate side effects

The guide SHALL provide machine-actionable next steps for session conflicts, session terminal states,
runtime/backend absence, and long hardware workflow timeouts without encouraging repeated side effects.

#### Scenario: Session is closed or not open

- **WHEN** a terminal tool returns `NOT_OPEN` or `SESSION_CLOSED`
- **THEN** the guide directs the AI to inspect current sessions and reopen only when no compatible
  active session exists

#### Scenario: Host request times out during a hardware workflow

- **WHEN** a long control workflow may outlive an MCP tool-call deadline
- **THEN** the guide directs the AI to use background mode and recover with job status/evidence tools
- **AND** it forbids retrying flash, erase, reset, attach, or GDB startup solely because the host timed out

#### Scenario: Backend evidence is unavailable

- **WHEN** LinkTerm returns `NO_BACKEND`, missing-probe evidence, or an unavailable runtime capability
- **THEN** the guide forbids claiming connection, flash, reset, RTT, or debug success
- **AND** it does not suggest bypassing LinkTerm with external serial, SEGGER, J-Link, GDB, or VS Code tools

### Requirement: Startup and configuration boundaries are explained

The guide SHALL distinguish a simple one-off terminal, a workspace/control profile, and a system-level
Agent integration. It SHALL describe `get_app_status` as read-only observation that may enumerate
serial ports and visible probes but does not connect to or mutate hardware.

#### Scenario: AI needs a one-off serial terminal

- **WHEN** no workspace is needed and the user supplies or selects serial configuration
- **THEN** the guide permits the session tools without requiring workspace creation

#### Scenario: Workspace root is known

- **WHEN** a root with `.linkterm/config.json` or `.linkterm/control-profile.json` is available
- **THEN** the guide directs the AI to reuse the stored device, connection, firmware, and control facts
- **AND** it does not claim that MCP can enumerate App-only saved connection records that are not
  exposed as MCP tools

#### Scenario: Agent integration is installed

- **WHEN** LinkTerm writes a VS Code, Cursor, Claude Desktop, or Codex MCP configuration
- **THEN** the guide explains that the configuration contains connection command/URL/auth facts
- **AND** MCP initialize and tool surfaces remain the source of runtime operating guidance

### Requirement: Maintainer documentation identifies all synchronization points

The repository SHALL contain `docs/mcp-usage-guide.md` explaining the operating model, guidance
generation, direct/proxy injection, detailed runbook, key tool descriptions, integration-config
boundary, specification/test synchronization, host limitations, and non-hardware verification path.

#### Scenario: Maintainer changes MCP behavior or guidance

- **WHEN** a maintainer reads the guide before changing an MCP workflow
- **THEN** it identifies the exact source and test locations that must remain synchronized
- **AND** it explains that prompt text cannot replace Main-owned runtime enforcement
