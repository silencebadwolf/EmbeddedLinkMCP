## 1. Characterization and specification

- [x] 1.1 Record current initialize, runbook, tool-description, integration-config, serial, terminal,
  workflow, Activity/Audit, and hardware-evidence facts with source/test evidence.
- [x] 1.2 Record the legacy confirmation-spec conflict and constrain this change to guidance/spec
  alignment without runtime-policy changes.
- [x] 1.3 Strictly validate the independent `align-mcp-runtime-usage-guide` OpenSpec change.

## 2. Red tests

- [x] 2.1 Add RED direct-initialize tests for startup status, serial create-or-reuse, shared ownership,
  bounded settle, automatic execution, background recovery, and absence of approval/pause/take-over.
- [x] 2.2 Add a RED in-memory stdio-proxy initialize test proving core guidance parity with direct MCP.
- [x] 2.3 Add RED runbook tests for conditional discovery, shared-session close guidance, structured/
  Markdown semantic consistency, error recovery, and no automatic state-affecting retries.
- [x] 2.4 Add RED `tools/list` tests for terminal create-or-reuse, conditional discovery, host-side
  write acceptance, bounded settle, shared close, conflict handling, and workflow timeout recovery.
- [x] 2.5 Add Agent integration characterization tests proving managed JSON/TOML/HTTP configurations contain no
  duplicated runbook/prompt fields.

## 3. Layered runtime guide

- [x] 3.1 Align compact initialize instructions with the verified startup, session, terminal,
  automatic-execution, background-job, firmware, and evidence model.
- [x] 3.2 Align `RUNBOOK_WORKFLOWS`, safety rules, Markdown rendering, and structured metadata with
  conditional discovery and shared-session ownership.
- [x] 3.3 Correct `get_app_status` wording to distinguish read-only enumeration from hardware
  connection or mutation.
- [x] 3.4 Align key terminal, runbook/status, control-profile/workflow, RTT, and high-impact tool
  descriptions without changing handlers or schemas.
- [x] 3.5 Add the narrow stdio-proxy construction seam and prove initialize delivery through an
  in-memory client.

## 4. Maintainer manual

- [x] 4.1 Add `docs/mcp-usage-guide.md` with operating model, guidance layers, source/injection map,
  direct/proxy behavior, configuration boundary, session/workspace choices, errors, evidence, and
  synchronization checklist.
- [x] 4.2 Document MCP-host limitations and explain why instructions cannot replace Main-owned
  enforcement.
- [x] 4.3 Cross-check source links, tool names, error codes, and all no-hardware claims against code.

## 5. Review and verification

- [x] 5.1 Run focused runbook, terminal, stdio-proxy, tool-description, workflow, and Agent integration
  tests after each TDD slice.
- [x] 5.2 Run full tests with coverage, lint, TypeScript/Vite build, license validation, strict
  OpenSpec validation, and diff hygiene.
- [x] 5.3 Request code review and address valid high-confidence feedback.
- [x] 5.4 Run GitNexus `detect_changes`, PDG impact, and directed taint review for changed trust
  boundaries; record that zero findings are not proof of safety.
- [x] 5.5 Verify with protocol-level clients that direct initialize, proxy initialize,
  `get_agent_runbook`, and `tools/list` expose the intended guide.
- [x] 5.6 Record that no real serial open, flash, erase, reset, probe/RTT/debug connection, GDB start,
  commit, push, PR, reset, checkout, or worktree cleanup was performed.
