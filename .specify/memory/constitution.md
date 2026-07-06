# LinkTerm Constitution

## Principles

### I. Shared Session Runtime
All human UI and MCP automation entry points MUST use the shared session runtime and preload IPC contracts. Renderer code MUST NOT bypass `window.linkterm` namespaces or hold transport objects directly.

### II. Observable Control Workflows
Workspace control profiles MUST keep serial and RTT observation channels mutually exclusive. When a user opens a saved control profile, the UI MUST show the selected profile facts and the observation channel state without hiding failures behind modal-only messages.

### III. Test-First Renderer Changes
Renderer behavior changes MUST be covered by targeted tests that fail before implementation and pass after the smallest production change.

### IV. Low-Risk Brownfield Changes
Existing global store contracts, IPC payload shapes, and session metadata semantics MUST remain backward compatible unless a feature spec explicitly requires a migration.

## Governance

Feature work in this repository follows the local `AGENTS.md` rules, including GitNexus impact analysis before editing indexed symbols and `detect_changes()` before commit-ready handoff.
