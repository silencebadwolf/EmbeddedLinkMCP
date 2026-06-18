## Why

Packaged LinkTerm users cannot rely on repository documentation or external agent skills to teach an AI how to operate the runtime safely. LinkTerm needs a first-party MCP capability that exposes a runtime-generated operation runbook so AI clients can discover safe workflows, required confirmations, and evidence expectations before touching serial, J-Link, flash, RTT, debug, or UI surfaces.

## What Changes

- Add a new MCP runbook capability that returns a generated AI operation guide for the running LinkTerm instance.
- Expose the guide through a tool-first MCP surface, with `get_agent_runbook` as the primary entry point.
- Return both a human-readable Markdown runbook and structured JSON that enumerates capabilities, workflows, safety rules, and non-sensitive runtime/profile summaries.
- Derive the runbook from packaged runtime metadata, registered MCP surfaces, high-impact confirmation policy, and sanitized control-profile state instead of repository files.
- Explicitly document that AI clients must not bypass LinkTerm with `JLink.exe`, GDB, ad-hoc serial CLI, or VS Code tasks.
- Preserve existing terminal, debug, UI, workspace, and control-profile behavior; this change only adds a read-only guidance surface.

## Capabilities

### New Capabilities
- `mcp-agent-runbook`: Runtime-generated AI operation guide exposed over MCP, covering safe LinkTerm workflows, available capabilities, required confirmations, and sanitized profile/runtime facts.

### Modified Capabilities
- None.

## Impact

- Affected areas: `src/mcp/`, MCP registry/server composition, control-profile integration points, runtime metadata helpers, tests under `tests/unit` and `tests/integration`.
- API impact: adds a read-only MCP tool such as `get_agent_runbook`; no breaking changes to existing tools.
- Security impact: introduces a new MCP response containing operational guidance and sanitized configuration summaries; must enforce existing sensitive-field and J-Link serial-number redaction rules.
- Packaging impact: runbook content must be generated from code and runtime state included in packaged LinkTerm, not from source-only docs.
- Dependency impact: no new third-party runtime dependency is expected.
