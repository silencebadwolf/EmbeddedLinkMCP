## 1. Test scaffolding and contracts

- [x] 1.1 Add unit tests for `ControlWorkflowJobManager` lifecycle: create, start, state transitions, terminal states, TTL expiry, retained-job cap, and cleanup results.
- [x] 1.2 Add MCP tests proving `run_control_workflow` background mode returns `jobId` quickly and preserves synchronous mode when background execution is not requested.
- [x] 1.3 Add high-impact confirmation tests proving missing `confirm: true` creates no job, opens no serial session, and calls no J-Link backend method.
- [x] 1.4 Add tests for job status and evidence read tools, including active, succeeded, failed, cancelled, expired, and unknown job cases.
- [x] 1.5 Add cancellation tests proving `AbortSignal` reaches long-running J-Link operations and completed prior workflow evidence remains readable.
- [x] 1.6 Add tool registration/version-policy tests proving job read/status tools are read-only and cancellation/cleanup tools are state-affecting.
- [x] 1.7 Add runbook tests proving initialize instructions and `get_agent_runbook` recommend background jobs for long hardware workflows and forbid external CLI fallback.

## 2. Core job lifecycle implementation

- [x] 2.1 Implement a pure TypeScript `ControlWorkflowJobManager` with injected clock/options and no Electron imports.
- [x] 2.2 Define job types for `jobId`, state, timestamps, sanitized input snapshot, workflow mode, partial/final `ControlWorkflowData`, cancellation state, and expiry metadata.
- [x] 2.3 Enforce one active control workflow job at a time and return structured `INVALID_STATE` behavior for competing background workflow requests.
- [x] 2.4 Implement TTL and retained-job-cap cleanup without removing active jobs.
- [x] 2.5 Ensure job evidence stores terminal session/cursor references and structured debug evidence rather than embedding unbounded transcript data.

## 3. Workflow runner integration

- [x] 3.1 Extend `run_control_workflow` input schema with an explicit backward-compatible background execution mode.
- [x] 3.2 Add job creation path that validates input and confirmation before creating or starting a job.
- [x] 3.3 Refactor workflow execution so the background runner can call the existing deterministic workflow logic and update job evidence after each step or terminal failure.
- [x] 3.4 Thread `AbortSignal` through workflow execution, serial waits, and J-Link backend calls used by flash/reset/GDB/diagnose steps.
- [x] 3.5 Map cancellation to terminal job state `cancelled` with structured `ABORTED` evidence while preserving completed step history.
- [x] 3.6 Preserve the existing synchronous `run_control_workflow` output shape and behavior for default calls.

## 4. MCP tool surface

- [x] 4.1 Register background job tools in the control-workflow surface: job status, job evidence read, job cancellation, and job cleanup.
- [x] 4.2 Implement status tool output with lightweight state, timestamps, current step, workflow mode, expiry, and final summary/failure code when available.
- [x] 4.3 Implement evidence read tool output with partial/final `ControlWorkflowData`, job metadata, terminal cursor references, and bounded evidence metadata.
- [x] 4.4 Implement cancellation tool with idempotent terminal-job handling and state-affecting schema-version policy.
- [x] 4.5 Implement cleanup tool for explicit job cleanup and expired-job cleanup with removed-count reporting.
- [x] 4.6 Update core tool-set diagnostics so `get_app_status` can report the new job tools as expected runtime capabilities.

## 5. Runbook and documentation updates

- [x] 5.1 Update `get_agent_runbook` Markdown and structured workflow guidance to recommend background jobs for long flash/observe/debug workflows.
- [x] 5.2 Update initialize-time compact instructions to mention background mode without weakening high-impact confirmation or ownership-boundary rules.
- [x] 5.3 Update MCP tool descriptions so AI clients know to poll/read/cancel/cleanup jobs and not retry flash operations after host timeout.

## 6. Validation

- [x] 6.1 Run targeted unit tests for job manager, control workflow tools, runbook, tool-set diagnostics, and J-Link abort propagation.
- [x] 6.2 Run `pnpm test`.
- [x] 6.3 Run `pnpm run lint`.
- [x] 6.4 Run `pnpm run build`.
- [x] 6.5 Run `openspec validate add-control-workflow-background-jobs --strict`.
