## Why

LinkTerm's runtime behavior has evolved to shared human/AI terminal operation, Main-owned serial
create-or-reuse, bounded settle observations, automatic validated hardware execution, and
background workflow recovery. The MCP guidance is only partially aligned: detailed serial guidance
knows about reuse, while initialize instructions and terminal tool descriptions still imply that
serial opens always create a new session; several canonical guidance specs still describe removed
confirmation gates; and maintainers have no single source explaining where runtime instructions are
generated and delivered.

## What Changes

- Define one layered MCP operating guide across initialize instructions, `get_agent_runbook`,
  machine-readable workflow data, tool descriptions, and a maintainer document.
- Make serial guidance reuse-first: inspect Main-owned sessions, reuse compatible sessions, treat
  `open_session` as create-or-reuse, discover ports only when no known session/configuration exists,
  and handle `SERIAL_SESSION_CONFLICT` without retry loops.
- Describe shared-session ownership: human and AI writes use the same session/write queue/transcript,
  and an AI must not casually close a terminal shared with the user.
- Describe `send_and_wait` as one write plus a bounded settle observation; marker matches are
  metadata, empty output is not a crash proof, and the tool does not retry automatically.
- Align high-impact descriptions with the accepted observe-only policy: validated operations execute
  automatically and users observe Activity/Audit/backend evidence; legacy `confirm` fields do not
  authorize or gate execution.
- Correct startup wording: `get_app_status` performs read-only serial/probe discovery but does not
  connect to or mutate hardware.
- Document that Agent integration files contain transport launch/auth configuration only; runtime
  guidance remains packaged in LinkTerm and arrives through MCP initialize/tool surfaces.
- Add tests for direct and proxy initialize guidance, structured/Markdown consistency, key tool
  descriptions, prompt-free integration configuration, and prohibited legacy approval/pause/takeover
  language.

## Capabilities

### New Capabilities

- `mcp-runtime-usage-guide`: Defines the layered runtime manual, cross-layer consistency, truthful
  terminal/session/error guidance, delivery verification, and maintainer documentation.

### Modified Capabilities

- `mcp-agent-runbook`: Align initialize and detailed runbook requirements with serial reuse,
  bounded-settle reads, read-only discovery, automatic execution, and shared-session ownership.
- `debug-tool-description-safety`: Replace obsolete confirmation-language requirements with
  immediate-after-validation and evidence-observation requirements.
- `agent-integrations`: Specify that installed MCP configuration carries connection/auth facts but
  does not duplicate or persist the runtime operating guide.

## Impact

Expected implementation areas are `src/mcp/surfaces/agent-runbook/runbook.ts`, key MCP tool
descriptions (primarily terminal/runbook/workflow surfaces), the stdio proxy test seam,
`docs/mcp-usage-guide.md`, focused MCP and Agent integration tests, and this OpenSpec change. No
SessionManager, WriteQueue, Transport, serial protocol, J-Link backend, approval policy, pause state,
or hardware-control behavior is changed. Automated verification will not open real serial ports or
execute flash, erase, reset, probe-connect, RTT-connect, GDB, or debug side effects.
