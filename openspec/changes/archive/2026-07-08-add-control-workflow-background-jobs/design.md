## Context

LinkTerm's MCP server runs inside the Electron main process and owns the shared `SessionManager`, `TranscriptBuffer`, `WriteQueue`, control profile manager, and `IJLinkBackend`. `run_control_workflow` currently executes a whole flash/observe/debug sequence inside one MCP tool handler and returns final `ControlWorkflowData` only after all steps complete.

That synchronous shape works for short operations, but large raw binary flashes can outlive the MCP Host's single request deadline. When the host cuts off the request, the AI client cannot reliably retrieve the final step state, reset/observe result, or cancellation status, even if LinkTerm and SEGGER are configured with longer internal timeouts. The fix must preserve LinkTerm's ownership boundary: no external J-Link/GDB/serial CLI fallback, no VS Code task fallback, and no alternate transport outside LinkTerm MCP.

## Goals / Non-Goals

**Goals:**

- Let AI clients start long-running control workflows and receive a `jobId` quickly.
- Keep the workflow running in the Electron main process after the initiating MCP request returns.
- Let clients poll status, retrieve structured evidence, cancel active work, and clean up retained jobs.
- Preserve high-impact confirmation gates before any hardware side effect or background job creation.
- Preserve existing synchronous `run_control_workflow` behavior for compatible clients.
- Keep serial output, debug evidence, failure classification, `nextActions`, and transcript cursors recoverable after host request timeout.
- Bound memory and lifetime with active-job limits, retained-job limits, and TTL cleanup.

**Non-Goals:**

- No persistent job database across app restarts in the first implementation; jobs are in-memory runtime state.
- No direct J-Link/GDB/serial CLI fallback.
- No renderer UI job dashboard in this change.
- No generalized background job framework for all MCP tools; the scope is control workflow jobs.
- No real hardware flashing in unit tests; tests use fake backends/transports.

## Decisions

### Decision 1: Add background mode to `run_control_workflow` instead of replacing it

`run_control_workflow` gains an optional execution mode, for example `execution: { mode: "background" }` or an equivalent strict schema branch. In background mode the handler validates input, checks confirmation, creates a job, starts execution asynchronously, and returns a structured result containing `jobId`, initial state, and polling tool names. In the default synchronous mode the existing return shape remains unchanged.

Rationale: existing clients and tests rely on synchronous behavior. A separate `start_control_workflow_job` tool would avoid overloading, but it would duplicate input schema and weaken the preferred high-level workflow story. Extending `run_control_workflow` keeps one entry point while making long operations opt-in and discoverable.

Alternatives considered:
- Always background every high-impact workflow. Rejected because it would be a breaking behavior change for existing callers that expect final evidence from `run_control_workflow`.
- Only increase timeouts. Rejected because MCP Host request deadlines remain outside LinkTerm's control.

### Decision 2: Introduce a dedicated in-memory `ControlWorkflowJobManager`

Create a small main-process-owned manager for control workflow jobs. It stores job metadata, sanitized input snapshot, current status, partial/final `ControlWorkflowData`, cancellation controller, timestamps, TTL, and cleanup hooks. It is injected into the control-workflow MCP surface alongside `SessionManager`, `ControlProfileManager`, and `IJLinkBackend`.

Rationale: this keeps job lifecycle separate from MCP registry serialization and from the workflow runner itself. The runner can stay focused on deterministic step execution while the manager owns lifecycle, concurrency, retention, and cancellation.

Alternatives considered:
- Store jobs in module-level maps inside `tools.ts`. Rejected because it is harder to test and harder to inject into `createMcpServer` fixtures.
- Persist jobs to disk. Rejected for the first change because evidence can include transient handles and cursor references that are only meaningful within the current process.

### Decision 3: Make job status and evidence retrieval separate tools

Add tools with stable responsibilities:

- `get_control_workflow_job_status`: read-only summary of state, timestamps, current step, final summary if available, and expiry.
- `read_control_workflow_job`: read-only full structured evidence, including partial or final `ControlWorkflowData` and terminal cursor references.
- `cancel_control_workflow_job`: state-affecting cancellation of an active job.
- `cleanup_control_workflow_jobs`: state-affecting cleanup of completed/expired jobs, with optional `jobId` or policy filters.

Rationale: status polling should be small and safe; evidence retrieval may be larger. Cancellation and cleanup have side effects and should remain distinct for version-mismatch policy and audit clarity.

Alternatives considered:
- One overloaded `control_workflow_job` tool with an action enum. Rejected because separate tool names improve AI discoverability and tool-set diagnostics.

### Decision 4: Job evidence uses existing workflow data plus job metadata

The job stores and returns the same `ControlWorkflowData` shape used by synchronous mode, wrapped with job metadata. Additional metadata includes `jobId`, `state`, `createdAt`, `startedAt`, `completedAt`, `expiresAt`, `cancelRequested`, and `correlationId`. Workflow steps continue to carry structured evidence and errors. Serial observation steps must record `sessionId`, observation start/end cursors, and whether transcript reads were truncated, rather than embedding unrelated debug output into terminal transcripts.

Rationale: reusing `ControlWorkflowData` preserves existing failure-code and `nextActions` contracts while making recovery after host timeout straightforward.

### Decision 5: Cancellation uses `AbortController` and cooperative step checks

Each running job owns an `AbortController`. `cancel_control_workflow_job` marks cancellation requested and aborts the controller. `runControlWorkflow` or a thin job runner wrapper accepts an optional `AbortSignal`; J-Link long operations receive it through existing backend methods, serial waits are raced against abort, and step boundaries check cancellation before starting more hardware actions. A cancelled job returns a final state of `cancelled` with an `ABORTED` error/evidence record.

Rationale: LinkTerm already models aborts in J-Link errors. Cooperative cancellation avoids unsafe force-kill semantics while providing deterministic evidence.

### Decision 6: Enforce confirmation before job creation

For high-impact modes, background mode reuses the same `requiresHighImpact`/`confirm=true` logic before the job is enqueued or started. If confirmation is missing, `run_control_workflow` returns `CONFIRMATION_REQUIRED`; the job manager must show no new job and the backend ledger must show no hardware call.

Rationale: a job that will later flash/reset/start GDB is already a high-impact operation at creation time.

### Decision 7: Bound lifecycle and concurrency

Initial defaults:

- one active control workflow job at a time per runtime, because J-Link probe operations and serial ownership are stateful;
- retained completed jobs capped by count, for example 32;
- completed job TTL, for example 30 minutes;
- expired jobs are cleaned opportunistically on job creation/status/read/cleanup calls;
- active jobs are not expired while running, but can be cancelled explicitly.

If an active job already exists, a new background workflow returns `INVALID_STATE` or a structured blocking result rather than starting competing flash operations.

Rationale: this prevents unbounded memory growth and avoids concurrent probe/flash workflows fighting over the same physical target.

## Risks / Trade-offs

- Host tool schemas may cache old `run_control_workflow` input schema → expose job mode in tool descriptions and tests, and keep synchronous mode valid for old clients.
- Background jobs are lost on app restart → document in runbook/status evidence that jobs are runtime-local; no false persistence claim.
- Cancellation may not interrupt every backend immediately → require step-boundary checks and pass `AbortSignal` into every long operation; return best-effort cancellation evidence.
- Serial observation can still outlive cancel if not raced → update observation wait path to race with abort and record `ABORTED`.
- Job evidence could grow too large → store structured workflow step evidence and transcript cursors, not full serial transcript dumps; clients can call `read_from_session` for terminal bytes.
- Concurrency limits may block legitimate multi-target use → first implementation favors safety; future work can key active job limits by probe/session once ownership is modelled.

## Migration Plan

1. Add pure unit tests and fake backend coverage for job manager lifecycle before production implementation.
2. Add background-mode schema and tools while leaving synchronous `run_control_workflow` unchanged by default.
3. Add runbook/tool descriptions so AI clients know to use background mode for long flash workflows.
4. Restart LinkTerm runtime after implementation so MCP hosts see updated tool schemas.
5. Rollback is straightforward: clients can keep using existing synchronous mode; removing job tools only removes the new opt-in path.

## Open Questions

- Exact public input spelling: `execution: { mode: "background" }` versus `background: true`. Prefer the structured `execution` branch unless implementation complexity argues otherwise.
- Whether completed job TTL should be configurable through runtime constants or hardcoded initially.
- Whether future UI should show active jobs; out of scope for this change.
