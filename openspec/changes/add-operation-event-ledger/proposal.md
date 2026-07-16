## Why

Phase 0 now locks LinkTerm's shared registry, confirmation, session-error, and background-job behavior, but calls that enter a LinkTerm MCP handler still have no common, queryable lifecycle. Phase 1 establishes the read-only observability seam needed by the later Activity Center and Approval Broker while the existing business and authorization contracts are still protected by characterization tests.

## What Changes

- Add versioned internal activity events and an explicitly mapped display-safe view with separate logical `Operation` and per-invocation `CallAttempt` state machines. Every MCP call that passes SDK validation and enters the central wrapper receives a server-generated `operationId`, a unique `callId`, and exactly one finish-once terminal decision; a healthy ledger accepts at most one matching terminal event.
- Add an allowlist-first redactor and a complete runtime risk/redaction policy aligned with the reviewed 63-tool Phase 0 inventory. Credentials, tokens, paths, scripts, firmware/binary data, memory-write values, screenshots, and arbitrary evidence bodies are removed or reduced to approved metadata before an event can enter the ledger.
- Add a bounded, in-memory `OperationLedger` with monotonic runtime cursors, predictable truncation, snapshots/read-since queries, isolated subscribers, and visible drop/health diagnostics. The ledger remains a best-effort observation projection and is not authorization authority.
- Add an `OperationRecorder` at the central `registerTool` seam and attach the shared `ControlWorkflowJobManager` lifecycle as workflow milestones. Instrumentation failures cannot alter the existing tool result, exception behavior, job result, or hardware/backend call count.
- Add typed Main/preload activity subscription and snapshot APIs that expose only validated, display-safe DTOs and support listener-before-snapshot hydration across Renderer reloads.
- Add state-machine fixtures for a future approval-required call and retry reusing a server-owned logical operation. No production approval continuation, grant, Pause, Activity Center UI, durable storage, export, or audit retention is enabled in this change.

## Capabilities

### New Capabilities

- `operation-event-ledger`: Defines Phase 1 Operation/CallAttempt identity and lifecycle, write-before-ledger redaction, bounded in-memory querying, registry and workflow-job recording, best-effort failure semantics, and the display-safe activity IPC/preload boundary.

### Modified Capabilities

No existing capability requirement changes. Existing MCP results, confirmation behavior, job behavior, Main trust boundaries, and hardware abstractions remain compatible; this change adds a side-channel observation capability only.

## Impact

- Expected new implementation areas: internal retained/reducer schemas under `src/core/activity/`, display-safe IPC/view schemas under `src/shared/`, `src/main/ipc/activity-ipc.ts`, and focused unit/integration tests.
- Expected narrow integrations: `src/mcp/registry.ts`, `src/mcp/server.ts`, `src/mcp/surfaces/control-workflow/job-manager.ts`, `src/mcp/surfaces/control-workflow/tools.ts`, `src/main/ipc/control-profile-ipc.ts`, `src/main/ipc/index.ts`, `src/shared/ipc-protocol.ts`, `src/shared/preload-api.ts`, `src/main/preload.ts`, and `tests/fixtures/mock-preload-api.ts`. `src/mcp/http-runtime-server.ts` already inherits and spreads server options, so it requires propagation tests but no planned functional edit.
- The Main composition root owns one runtime-scoped ledger/recorder shared by direct stdio, short-lived HTTP MCP servers, JobManager, and activity IPC. Renderer receives immutable display-safe DTOs only; no Main-only approval, principal, grant, lease, compensation, raw payload, or backend handle is introduced or exposed.
- `registerTool`, `ControlWorkflowJobManager`, and `PreloadAPI` are currently HIGH-risk shared seams in the GitNexus index. They, their selected methods, and every other existing symbol actually edited require fresh upstream-impact reports and user-visible HIGH/CRITICAL blast-radius warnings before implementation; security-critical registry/redaction changes also require directed PDG/taint review.
- The supported production surface for this change is the Electron Main owner plus its local HTTP endpoint/stdio proxy. The orphaned `src/mcp/stdio-entry.ts` executable is documented as a legacy non-default development entry and is not an advertised product/Agent integration; Phase 1 MUST either keep that exclusion explicit in user/developer documentation or give it a separately owned queryable recorder before it can be considered supported.
- No new runtime dependency, cloud service, database, account, telemetry, remote approval, persistence, hardware rollback promise, or real hardware operation is introduced.
