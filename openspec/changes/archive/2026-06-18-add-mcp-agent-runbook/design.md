## Context

LinkTerm is shipped as a packaged Electron application. An AI client that connects to its MCP server may not have access to the source repository, project-specific skills, or developer documentation. Today the MCP server exposes terminal, control-profile, control-workflow, debug, and UI tools, but the only general guidance is embedded in tool descriptions and server instructions. That is not enough for an agent to quickly choose the safe path, understand confirm gates, or avoid direct CLI fallback.

The new capability adds a first-party, read-only runbook surface to the packaged runtime. It must be usable immediately after MCP connection, independent of hardware availability and independent of repository files. The generated output should be concise enough for an AI to ingest, but structured enough for automation.

## Goals / Non-Goals

**Goals:**
- Expose a read-only MCP tool, `get_agent_runbook`, that is always registered.
- Return both Markdown instructions and structured JSON describing safe LinkTerm operations.
- Cover terminal, serial, control profile, control workflow, J-Link/debug/flash/RTT/GDB, and UI capabilities at a workflow level.
- Include high-impact operation confirmation rules, especially `flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, `gdb_server_start`, and high-impact `run_control_workflow` modes.
- Summarize current non-sensitive runtime/control-profile facts when a workspace root is provided.
- Avoid leaking credentials, tokens, private keys, J-Link serial numbers, runtime bearer tokens, or unnecessary absolute firmware paths.
- Keep all behavior packaged in LinkTerm source code and runtime state, not in source-repository Markdown documents.

**Non-Goals:**
- Do not implement a new external skill or require agent-plugin installation.
- Do not add a destructive or state-affecting operation.
- Do not change existing control-profile persistence, activation, flash, debug, terminal, or UI tool behavior.
- Do not make MCP resources mandatory; a future resource alias can be added after tool adoption is proven.
- Do not teach target-board-specific debugging beyond facts already present in sanitized runtime/profile state.

## Decisions

### 1. Tool-first MCP surface

Add a new MCP surface under `src/mcp/surfaces/agent-runbook/` and register `get_agent_runbook` from `createMcpServer` unconditionally.

Rationale: MCP tool calls are consistently available across current AI clients. MCP resources are less reliably auto-read by clients, so making the runbook a tool gives the agent an explicit first action.

Alternative considered: adding only a resource such as `linkterm://agent/runbook`. This is cleaner semantically but not portable enough for the immediate requirement. The design can later add a resource that reuses the same runbook builder.

### 2. Generated content uses a static capability catalog plus runtime state

Create a small internal capability catalog for LinkTerm surfaces, tool names, workflow recommendations, evidence expectations, and high-impact confirmation policy. The runbook builder combines that catalog with runtime inputs such as schema version and optional sanitized control-profile summary.

Rationale: The MCP SDK does not expose a stable, typed registry introspection API suitable for building user-facing guidance. A local catalog is explicit, testable, and can be reviewed when tools change.

Alternative considered: parsing registered tools from the SDK server. This risks depending on private SDK internals and would make the runbook brittle.

### 3. Optional workspace root for profile-aware guidance

`get_agent_runbook` accepts an optional absolute `root`. If supplied and a `ControlProfileManager` is available, the tool attempts to inspect the profile and includes a sanitized summary. If omitted, absent, invalid, or unavailable, the tool still succeeds and explains what information is missing.

Rationale: The first call should work even when the AI does not yet know a workspace root. Profile-aware details improve accuracy but must not be required for basic guidance.

Alternative considered: requiring `root`. That would block the primary use case: an AI connecting to packaged LinkTerm and asking what to do next.

### 4. Sanitized profile summary instead of raw profile echo

The runbook does not echo the entire control profile. It reports operationally useful, non-sensitive facts such as whether serial/J-Link/flash/RTT sections are configured, serial port/baud/mode, J-Link target/interface/speed, flash base address, verify flag, and whether a firmware binary is configured. Absolute firmware paths are represented as status fields rather than raw path strings unless a later product decision explicitly allows path disclosure.

Rationale: Existing profile tools may expose the full profile for explicit configuration workflows, but the runbook is intended as broad first-read context and should minimize accidental leakage.

Alternative considered: returning `get_control_profile` output verbatim. This is simpler but overexposes local file paths and future profile fields.

### 5. Dedicated evidence kind

Add an `agent_runbook` evidence kind for the new tool result.

Rationale: The runbook is neither terminal output, debug output, UI screenshot, nor workspace configuration. A dedicated kind makes tests and downstream clients easier to reason about.

Alternative considered: reuse `workspace_config`. This would blur a product guide with configuration evidence and make client routing less precise.

## Risks / Trade-offs

- **Catalog drift from actual registered tools** → Add unit tests that assert required high-impact tool names and core workflow tool names appear in the generated runbook. Keep the catalog near the surface implementation and update it when adding MCP tools.
- **Runbook becomes too verbose for AI context** → Keep Markdown concise and put detailed machine-readable workflow metadata in structured JSON. Avoid copying long source documentation.
- **Sensitive data leakage through profile summary** → Use a whitelist sanitizer rather than filtering after serialization. Test with profiles containing unexpected credential-like keys and J-Link probe serial-like values.
- **False confidence when hardware is unavailable** → Include availability/status fields and guidance that lack of profile/backend/hardware evidence is not proof of failure.
- **Resource support later duplicates logic** → Keep runbook generation in a pure builder module so a future MCP resource can reuse it without duplicating content.
