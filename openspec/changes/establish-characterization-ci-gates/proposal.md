## Why

LinkTerm is about to add operation instrumentation, first-success guidance, and human approval around shared runtime seams that currently serve all 63 production MCP tools. Before those higher-risk phases begin, the repository needs executable characterization of today’s behavior, a complete reviewed tool-risk inventory, and reproducible CI evidence so later changes cannot silently redefine existing contracts.

## What Changes

- Add deterministic characterization tests for the centralized `registerTool` wrapper, current `confirm=true` acknowledgement gates, `session:create` results whose opened session is already `errored`, and `ControlWorkflowJobManager` update/lifecycle behavior.
- Add a complete inventory for all 63 production MCP tools using the four specified operation-risk levels: `read-only`, `state-affecting`, `disruptive`, and `destructive-or-unknown`. The inventory is checked for exact name coverage, uniqueness, declared sensitivity, and an explicit rationale; it does not yet implement the Phase 5 authorization policy.
- Add clean-checkout CI gates for lint, build, full tests, and license validation using Node.js 22.13.0, the minimum that satisfies the current Electron and development-tool dependency graph, and pnpm 9.15.0, while retaining Windows-first manual acceptance and exercising macOS/Linux-compatible core automation. Third-party Actions are pinned to reviewed full commit SHAs and checkout credentials are not persisted.
- Install and pin the Vitest coverage provider, audit its installed production-dependency closure separately from runtime product dependencies, expose a non-interactive coverage-report command, and publish a report without introducing a global coverage threshold in this phase.
- Version the repository’s `.gitnexusrc` with `pdg: true` and document the mandatory GitNexus upstream-impact, PDG/taint interpretation, and `detect_changes` workflow for later implementation phases.
- Preserve all current runtime APIs, tool behavior, confirmation semantics, trust boundaries, and hardware abstractions; this phase performs no real probe, erase, flash, reset, GDB-server, RTT, serial-device, or other hardware side effect.

## Capabilities

### New Capabilities

- `engineering-quality-gates`: Defines Phase 0 characterization coverage, exact 63-tool risk-inventory checks, clean-checkout CI gates, report-only coverage, and GitNexus governance evidence.

### Modified Capabilities

No existing runtime capability requirements change in Phase 0. The new capability verifies and documents behavior already implemented under the existing registration, confirmation, session, and background-job boundaries.

## Impact

- Expected implementation areas:
  - characterization tests under `tests/unit/mcp/`, `tests/unit/main/ipc/`, and `tests/integration/`;
  - a reviewable security/engineering inventory plus a deterministic completeness validator;
  - `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `.gitignore`, `.gitnexusrc`, and CI workflow configuration;
  - development/governance documentation and the A+D decision record.
- No production handler, `SessionManager`, `WriteQueue`, transport, `IJLinkBackend`, manager, Main trust boundary, preload contract, Renderer DTO, or user-visible behavior is intentionally changed.
- One development-only coverage dependency and its audited production-dependency closure are expected; they remain explicitly separate from the 19 runtime manifest entries. No runtime dependency, cloud service, account, database, telemetry, remote approval, or hardware rollback mechanism is introduced.
- `registerTool` is a HIGH-risk hub (11 direct dependents, 15 impacted symbols, 2 affected process groups in the current GitNexus index). Phase 0 characterizes it but does not instrument or alter it; any later edit requires a fresh upstream-impact report.
