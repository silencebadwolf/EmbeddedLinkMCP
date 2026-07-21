# control-workflow-background-jobs Specification

## Purpose

Define background execution, polling, evidence retrieval, cancellation, cleanup, and lifecycle limits for long-running LinkTerm control workflows.
## Requirements
### Requirement: Background workflow creation
LinkTerm SHALL allow `run_control_workflow` to start a long-running control workflow as an in-memory background job and return a stable job identifier without waiting for all workflow steps to complete.

#### Scenario: Background workflow returns quickly
- **WHEN** an MCP client calls `run_control_workflow` with a valid background execution mode and valid workflow input
- **THEN** LinkTerm returns a successful tool result containing `jobId`
- **AND** the result indicates the job state is `queued` or `running`
- **AND** the result includes the tool names clients can use to poll status, read evidence, cancel, and clean up the job
- **AND** the call does not wait for the flash, reset, observe, or diagnose steps to finish

#### Scenario: Synchronous workflow remains compatible
- **WHEN** an MCP client calls `run_control_workflow` without requesting background execution
- **THEN** LinkTerm preserves the existing synchronous `ControlWorkflowData` behavior
- **AND** existing supported `flash-observe`, `debug-diagnose`, and `flash-observe-diagnose` modes remain accepted

#### Scenario: Background job owns LinkTerm runtime abstractions
- **WHEN** a background workflow job executes
- **THEN** the job uses the same Electron main-process `SessionManager`, `WriteQueue`, `TranscriptBuffer`, control profile manager, and `IJLinkBackend` instances as normal MCP tools
- **AND** the job does not call J-Link, GDB, flash, serial, or VS Code task executables outside LinkTerm's backend abstractions

### Requirement: Automatic execution before job creation
LinkTerm SHALL create or start a validated background workflow job without requiring caller confirmation.

#### Scenario: Legacy confirmation metadata does not gate job creation
- **WHEN** an MCP client requests a valid background `run_control_workflow` mode with `confirm` omitted, `false`, or `true`
- **THEN** LinkTerm creates the background job and executes it after normal admission checks
- **AND** the `confirm` value is ignored for authorization
- **AND** Activity and audit observations remain available for the resulting high-impact operations

#### Scenario: Dry run does not require high-impact job side effects
- **WHEN** an MCP client requests a background workflow with `dryRun: true`
- **THEN** LinkTerm returns dry-run planning evidence without creating a hardware-executing job
- **AND** no flash, reset, GDB server, or serial open side effect is performed

### Requirement: Job status polling
LinkTerm SHALL expose a read-only MCP tool for retrieving lightweight status of a control workflow job.

#### Scenario: Active job status is reported
- **WHEN** an MCP client calls the job status tool with an existing active `jobId`
- **THEN** LinkTerm returns the job state
- **AND** the result includes `createdAt`, `startedAt` when available, `expiresAt`, current step identifier when available, and the originating workflow mode
- **AND** the result does not include large terminal transcripts or raw binary payloads

#### Scenario: Completed job status is reported
- **WHEN** an MCP client calls the job status tool for a completed job
- **THEN** LinkTerm returns a terminal state of `succeeded`, `failed`, or `cancelled`
- **AND** the result includes final summary fields and the final workflow failure code when applicable

#### Scenario: Missing job is structured
- **WHEN** an MCP client calls the job status tool with an unknown or expired `jobId`
- **THEN** LinkTerm returns a structured error with code `NOT_FOUND` or `INVALID_ARGUMENT`
- **AND** the result does not expose unrelated job identifiers or private runtime data

### Requirement: Job evidence retrieval
LinkTerm SHALL expose a read-only MCP tool for retrieving partial or final structured evidence for a control workflow job.

#### Scenario: Partial evidence is readable while running
- **WHEN** an MCP client reads a running background workflow job
- **THEN** LinkTerm returns all completed workflow steps recorded so far
- **AND** each step preserves its structured evidence or error information
- **AND** the result indicates that the job is not yet terminal

#### Scenario: Final evidence is recoverable after host timeout
- **WHEN** the MCP Host times out the original background job creation call or the AI client loses the initiating response but later has a valid `jobId`
- **THEN** the AI client can call the evidence retrieval tool with that `jobId`
- **AND** LinkTerm returns the final `ControlWorkflowData` if the job has completed
- **AND** the result includes final step statuses, summary, `failedStep`, `failureCode`, and `nextActions` when present

#### Scenario: Terminal evidence is referenced by cursor
- **WHEN** a background workflow opens or reuses a serial session and observes terminal output
- **THEN** job evidence includes the serial `sessionId` and relevant transcript cursor boundaries
- **AND** terminal bytes remain retrievable through LinkTerm session transcript tools
- **AND** J-Link debug output is not appended to terminal transcripts as device output

### Requirement: Job cancellation
LinkTerm SHALL expose a state-affecting MCP tool for cancelling an active control workflow job.

#### Scenario: Active job can be cancelled
- **WHEN** an MCP client calls the cancellation tool with an active `jobId`
- **THEN** LinkTerm marks the job cancellation as requested
- **AND** LinkTerm aborts the job's cancellation signal
- **AND** long-running J-Link operations receive an `AbortSignal`
- **AND** serial waits are interrupted or prevented from starting at the next safe boundary

#### Scenario: Cancelled job has final evidence
- **WHEN** a background workflow job is cancelled
- **THEN** the job reaches terminal state `cancelled`
- **AND** reading the job evidence returns an `ABORTED` error or cancellation evidence
- **AND** completed prior steps remain visible in order

#### Scenario: Terminal job cancellation is idempotent
- **WHEN** an MCP client cancels a job that already reached `succeeded`, `failed`, or `cancelled`
- **THEN** LinkTerm returns the current terminal state without starting new hardware actions
- **AND** the stored final evidence is preserved until cleanup or expiry

### Requirement: Job lifecycle limits and cleanup
LinkTerm SHALL bound background workflow job lifecycle using active job limits, retained job limits, and TTL cleanup.

#### Scenario: Concurrent active workflow is rejected
- **WHEN** a background control workflow job is already active and another background workflow is requested
- **THEN** LinkTerm rejects the second request with a structured `INVALID_STATE` or equivalent blocking result
- **AND** no additional flash, reset, GDB, or serial side effect is started for the rejected request

#### Scenario: Completed jobs expire
- **WHEN** a completed job is older than the configured retention TTL
- **THEN** LinkTerm may remove it during job creation, status, read, cancel, or cleanup calls
- **AND** subsequent reads for that job return a structured missing-job error

#### Scenario: Cleanup tool removes retained jobs
- **WHEN** an MCP client calls the cleanup tool for a completed job or expired jobs
- **THEN** LinkTerm removes matching non-active jobs
- **AND** LinkTerm reports how many jobs were removed
- **AND** active jobs are not removed unless they are cancelled first

### Requirement: Tool registration and version policy
LinkTerm SHALL register the background workflow job tools as part of the control-workflow MCP surface and expose them through runtime tool diagnostics.

#### Scenario: Job tools are discoverable
- **WHEN** LinkTerm MCP registers control workflow tools
- **THEN** the tool set includes job status, evidence read, cancellation, and cleanup tools
- **AND** `get_app_status` tool-set diagnostics reflect the registered job tools

#### Scenario: Read-only job tools allow schema mismatch warnings
- **WHEN** a client with a mismatched schema version calls job status or job evidence read tools
- **THEN** LinkTerm follows the existing read-only version mismatch policy
- **AND** any warning is attached to evidence metadata when the call is allowed

#### Scenario: State-affecting job tools reject schema mismatch
- **WHEN** a client with a mismatched schema version calls job cancellation or cleanup tools
- **THEN** LinkTerm follows the existing state-affecting version mismatch rejection policy
