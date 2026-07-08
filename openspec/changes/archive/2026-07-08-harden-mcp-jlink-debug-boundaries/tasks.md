## 1. Baseline and reference audit

- [x] 1.1 Review `proposal.md`, `design.md`, and all delta specs before touching source code.
- [x] 1.2 Record the JLinkMCP reference as design-only input in implementation notes; verify no source, script, hardcoded target/interface/speed, temp-file policy, or raw-output model is copied.
- [x] 1.3 Inspect active changes `complete-jlink-debug-backend` and `improve-control-workflow-efficiency` to avoid overlapping feature implementation.

## 2. Runtime and tool-set diagnostics

- [x] 2.1 Add or update unit tests for `RuntimeDiagnostics` covering owner/proxy/stdio/not-started labels and metadata unavailable/stale/fresh cases.
- [x] 2.2 Add or update tests for `ToolSetDiagnostics` covering deterministic sorting, deduplication, hash stability, complete core list, and missing core tools.
- [x] 2.3 Update `get_app_status` evidence to expose required runtime identity, transport, metadata, core tool completeness, missing tools, and tool-set hash fields.
- [x] 2.4 Verify startup status remains read-only by asserting it does not call session write/open, screenshot capture, J-Link backend state-changing methods, or workspace writes.

## 3. MCP registry and surface boundaries

- [x] 3.1 Add tests that new LinkTerm MCP tools must pass through the registry wrapper with sensitivity, schema, description, origin enforcement, schemaVersion, and normalized errors.
- [x] 3.2 Add boundary tests proving debug MCP surfaces call only `IJLinkBackend` and never import or invoke SEGGER runners, GDB clients, serial CLIs, or VS Code task APIs.
- [x] 3.3 Add evidence-kind isolation tests for terminal, debug, workflow, app status/runbook, and UI screenshot results.
- [x] 3.4 Update tool descriptions for high-impact debug and workflow tools to state confirmation requirements and prohibit direct CLI fallback.

## 4. J-Link runner policy

- [x] 4.1 Add tests for trusted absolute Commander and GDB server executable paths, rejecting bare or relative paths before process spawn.
- [x] 4.2 Add tests for unique temporary Commander script generation, cleanup, no shared fixed filename, and safe concurrent operations.
- [x] 4.3 Add tests for shell-disabled process execution, argument-vector construction, bounded stdout/stderr capture, timeout/AbortSignal behavior, and redacted diagnostics.
- [x] 4.4 Update `src/jlink/` runner/client code only as needed to satisfy the runner policy tests without changing MCP surface ownership.

## 5. Debug evidence, errors, and confirmation gates

- [x] 5.1 Add MCP boundary tests proving `flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, and `gdb_server_start` return `CONFIRMATION_REQUIRED` without backend ledger calls when `confirm=true` is missing.
- [x] 5.2 Add tests proving binary high-impact tools do not decode malformed or oversized base64 before confirmation.
- [x] 5.3 Add tests for structured debug evidence projection from typed backend DTOs, including base64 only at MCP boundary and no raw SEGGER text as the sole success signal.
- [x] 5.4 Add or update error taxonomy tests so new domain errors require shared error code, `ToolErrorCode`, and translation branch updates.

## 6. Control profile and workflow provenance

- [x] 6.1 Add tests proving workflow/debug parameters are derived from control profile, current request, or explicit user-confirmed input rather than reference-repo defaults.
- [x] 6.2 Add tests proving missing target/interface/speed/firmware/baseAddress/RTT facts produce structured missing-configuration output instead of guessing nRF52/SWD/4000 kHz or sample addresses.
- [x] 6.3 Add tests proving complete profiles still require confirmation for flash, reset, and GDB server start workflows.
- [x] 6.4 Update control workflow evidence or metadata to expose non-sensitive parameter source where required by specs.

## 7. Runbook and AI guidance

- [x] 7.1 Update initialize instructions and `get_agent_runbook` content so AI clients prefer `get_app_status` for startup health and do not use screenshots as runtime health checks.
- [x] 7.2 Update runbook/status guidance to explain core tool-set diagnostics, missing-tool recovery, high-level workflow preference, and no external J-Link/GDB/flash/serial CLI fallback.
- [x] 7.3 Add tests for runbook/status content ensuring no copied JLinkMCP scripts, hardcoded target defaults, reference path dependency, or sensitive values are emitted.

## 8. Validation

- [x] 8.1 Run targeted unit tests for changed MCP runtime/status, registry, debug surface, control workflow, control profile, and J-Link runner modules.
- [x] 8.2 Run relevant integration boundary tests for confirmation gates, no-backend behavior, and app status/tool-set completeness.
- [x] 8.3 Run `openspec validate harden-mcp-jlink-debug-boundaries --strict` and fix any spec issues.
- [x] 8.4 Run `pnpm run lint`, `pnpm test`, `pnpm run build`, and `pnpm run validate:licenses` before claiming implementation complete.
