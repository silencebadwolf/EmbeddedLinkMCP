## Why

`run_control_workflow` can take longer than the MCP Host's single tool-call deadline when it performs real J-Link flash operations on large raw binaries. Increasing SEGGER/LinkTerm process timeouts alone does not solve this, because the AI client loses the final workflow result, reset/observe evidence, and cancellation control once the host request is cut off.

## What Changes

- Add a background job execution mode for long-running control workflows so `run_control_workflow` can quickly return a stable `jobId` instead of holding the MCP request open until flash/observe/debug completion.
- Add MCP tools for querying job status, reading final/partial job evidence, cancelling an active job, and clearing completed or expired jobs.
- Preserve the existing synchronous `run_control_workflow` behavior for short operations unless the caller explicitly requests background execution or the workflow selects it according to documented rules.
- Keep all job execution inside the Electron main process and existing LinkTerm abstractions: `SessionManager`, `WriteQueue`, `TranscriptBuffer`, `IJLinkBackend`, control profile manager, and J-Link runner.
- Enforce high-impact confirmation before a background job is created; missing `confirm: true` must return `CONFIRMATION_REQUIRED` without creating a job or touching hardware.
- Persist structured workflow evidence in job state so clients can recover results after MCP Host request timeout, including step status, failure codes, terminal cursor references, debug evidence, cancellation state, and final summary.
- Add bounded lifecycle management: job TTL, maximum retained jobs, active job limits, and deterministic cleanup semantics.

## Capabilities

### New Capabilities
- `control-workflow-background-jobs`: Covers background execution, polling, evidence retrieval, cancellation, cleanup, and lifecycle limits for long-running LinkTerm control workflows.

### Modified Capabilities
- `mcp-agent-runbook`: Extend AI guidance to prefer background jobs for long-running flash/observe/debug workflows and to recover evidence through polling rather than retrying or using external tools.

## Impact

- Affected code areas:
  - `src/mcp/surfaces/control-workflow/` for `run_control_workflow` input/output extensions and job tools.
  - `src/core/` or a new pure main-process-safe job manager module for in-memory job lifecycle, evidence retention, TTL, and cancellation.
  - `src/jlink/` only to ensure existing `AbortSignal` paths are used by job cancellation; no direct MCP surface bypasses.
  - `src/mcp/surfaces/agent-runbook/` for runbook and startup guidance updates.
  - Tests under `tests/unit/mcp/`, `tests/integration/`, and relevant fake J-Link/session fixtures.
- MCP API impact:
  - `run_control_workflow` gains a backward-compatible background mode that returns `jobId` and initial evidence quickly.
  - New read/control tools expose job status, evidence retrieval, cancellation, and cleanup.
  - Error/evidence contracts remain structured with existing `origin`, `schemaVersion`, `correlationId`, and evidence-kind conventions.
- Dependencies:
  - No new runtime dependency expected.
- Systems:
  - Long-running hardware workflows remain inside LinkTerm MCP ownership boundaries; AI clients must not use J-Link/GDB/serial CLI fallback.
  - Real hardware flashing is not required in the proposal or unit-test phases; behavior is verified with fake backends and deterministic job state tests.
