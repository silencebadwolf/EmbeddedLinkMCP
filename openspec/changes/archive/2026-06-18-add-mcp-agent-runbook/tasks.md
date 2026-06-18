## 1. Surface and schema

- [x] 1.1 Add `agent_runbook` to the shared MCP evidence kind union and ensure existing result serialization still compiles.
- [x] 1.2 Create `src/mcp/surfaces/agent-runbook/` with input schema for optional `root`, `correlationId`, and `clientSchemaVersion`.
- [x] 1.3 Register `get_agent_runbook` unconditionally from `createMcpServer` as a read-only tool.

## 2. Runbook generation

- [x] 2.1 Implement a pure runbook builder that returns Markdown plus structured JSON.
- [x] 2.2 Add a capability/workflow catalog covering terminal/serial, control profile, control workflow, J-Link debug, flash, RTT/GDB, and UI operations.
- [x] 2.3 Encode high-impact confirmation metadata for `flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, `gdb_server_start`, and high-impact `run_control_workflow` modes.
- [x] 2.4 Include LinkTerm ownership-boundary guidance that prohibits direct J-Link, GDB, serial CLI, and VS Code task fallback.

## 3. Runtime and profile summaries

- [x] 3.1 Add optional `ControlProfileManager` integration so `get_agent_runbook` can summarize a profile when `root` is provided.
- [x] 3.2 Implement whitelist-based sanitization for control-profile facts included in the runbook.
- [x] 3.3 Ensure missing root, missing profile, unavailable manager, invalid root, or schema mismatch still returns general guidance with a structured status instead of mutating state.
- [x] 3.4 Ensure runtime metadata tokens, credentials, private keys, passphrases, unknown fields, and J-Link serial numbers cannot appear in Markdown or JSON output.

## 4. Tests and validation

- [x] 4.1 Add unit tests for the runbook builder covering Markdown sections, structured workflows, high-impact confirmation metadata, and direct CLI prohibition text.
- [x] 4.2 Add unit tests for profile summary sanitization, including credential-like fields and path minimization.
- [x] 4.3 Add MCP surface tests proving `get_agent_runbook` is always registered, read-only, returns evidence kind `agent_runbook`, and follows read-only schema mismatch warning behavior.
- [x] 4.4 Run targeted Vitest tests for the new surface and then `pnpm test` or the project-appropriate validation command before marking implementation complete.
