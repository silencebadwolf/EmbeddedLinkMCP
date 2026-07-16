## ADDED Requirements

### Requirement: Shared runtime seams are protected by characterization tests

LinkTerm SHALL preserve executable characterization of the current `registerTool`, confirmation, session creation, and control-workflow job contracts before later phases change those seams.

#### Scenario: Registry wrapper returns a successful handler result

- **WHEN** a schema-valid call enters a tool registered through `registerTool` and its business handler succeeds
- **THEN** the handler is invoked exactly once
- **AND** the returned payload preserves the business evidence while forcing the current schema version, `origin: "ai"`, and the caller correlation identifier

#### Scenario: Registry wrapper returns a handler-declared failure

- **WHEN** a schema-valid call enters `registerTool` and its business handler returns a structured failure
- **THEN** the wrapper preserves the structured error, session state fields when present, correlation identifier, current schema version, and `origin: "ai"`
- **AND** the handler is not invoked a second time

#### Scenario: Registry rejects an incompatible state-affecting call

- **WHEN** a state-affecting registered tool receives an incompatible client schema version or the running code is stale under the existing runtime policy
- **THEN** the wrapper returns the current structured rejection before invoking the business handler
- **AND** the characterization asserts zero business-handler and effectful-backend invocations

#### Scenario: Read-only version mismatch remains inspectable

- **WHEN** a read-only registered tool receives an incompatible client schema version under the current policy
- **THEN** its business handler is still invoked exactly once
- **AND** a successful result carries the version warning in evidence metadata

#### Scenario: Stale-runtime exceptions remain available

- **WHEN** runtime code is stale
- **THEN** a read-only tool and a state-affecting tool explicitly marked `allowWhenRuntimeStale: true` still invoke their handlers under the current policy
- **AND** an ordinary state-affecting tool remains rejected before handler or backend invocation

#### Scenario: Registry normalizes thrown errors

- **WHEN** a registered business handler throws either a `ToolError` or an unexpected exception
- **THEN** the wrapper returns the current structured error taxonomy with the standard result envelope
- **AND** an unexpected exception does not escape the MCP boundary

#### Scenario: SDK rejects input before the LinkTerm handler

- **WHEN** an MCP request fails the SDK input schema before the registered LinkTerm callback is entered
- **THEN** no business handler or effectful fake backend is invoked
- **AND** the test does not claim that a normal LinkTerm operation started

### Requirement: Existing confirmation behavior remains explicitly characterized

LinkTerm SHALL characterize the current `confirm=true` caller-acknowledgement gate without treating it as a human approval grant and without introducing the Phase 5 Approval Broker in this change.

#### Scenario: Low-level J-Link confirmation is missing or false

- **WHEN** any tool in the current low-level matrix—`flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, `gdb_server_start`, `jlink_reboot`, or `jlink_commander_script`—is called with `confirm` omitted or `confirm: false`
- **THEN** it returns `CONFIRMATION_REQUIRED` with the guarded tool name
- **AND** its fake effectful backend invocation count remains zero

#### Scenario: Low-level J-Link confirmation is true

- **WHEN** a tool in the seven-tool low-level matrix receives valid input and `confirm: true`
- **THEN** the existing implementation invokes its fake backend exactly once
- **AND** the characterization labels this as caller acknowledgement rather than human approval

#### Scenario: Binary confirmation precedes payload decoding

- **WHEN** `flash_download` or `flash_write` receives malformed or oversized base64 input without `confirm: true`
- **THEN** it returns `CONFIRMATION_REQUIRED` before base64 parsing or buffer-limit details
- **AND** its fake backend invocation count remains zero

#### Scenario: Every currently valid control-workflow mode lacks confirmation

- **WHEN** `run_control_workflow` requests any currently schema-valid mode (`debug-diagnose`, `flash-observe`, or `flash-observe-diagnose`) without `confirm: true` and without `dryRun: true`
- **THEN** the synchronous path opens no session and invokes no effectful fake backend
- **AND** the background path creates no job in addition to opening no session and invoking no effectful fake backend
- **AND** adding `debug.haltOnFailure: true` does not bypass that existing mode gate; Phase 0 does not claim the flag is an independently isolatable trigger because every currently valid mode is already high-impact

#### Scenario: Control workflow is a dry run

- **WHEN** a high-impact `run_control_workflow` request uses `dryRun: true` without confirmation
- **THEN** it returns planning evidence without creating a background job
- **AND** it opens no session, connects no probe, flashes or resets nothing, and starts no GDB server

#### Scenario: Runtime restart lacks confirmation

- **WHEN** `restart_mcp_runtime` receives omitted or false confirmation
- **THEN** it returns `CONFIRMATION_REQUIRED` and schedules zero restarts

#### Scenario: Runtime restart has confirmation

- **WHEN** `restart_mcp_runtime` receives valid `confirm: true` while runtime code is stale
- **THEN** it invokes the injected fake restart scheduler exactly once under the existing `allowWhenRuntimeStale` exception

#### Scenario: Direct Download compatibility path is characterized

- **WHEN** either existing Main-process Control Profile direct Download channel—`CONTROL_PROFILE_RUN_DOWNLOAD` or `CONTROL_PROFILE_START_DOWNLOAD`—builds its workflow request
- **THEN** each currently produces `mode: "flash-observe"`, `confirm: true`, and disabled serial observation
- **AND** fake synchronous-runner and background-job assertions label this hard-coded confirmation as caller acknowledgement rather than human approval

#### Scenario: All current acknowledgement paths remain non-authoritative

- **WHEN** any Phase 0 true-confirm characterization succeeds
- **THEN** the test does not introduce or claim an Approval Broker, human grant, operation identity, admission lease, Pause policy, or Activity lifecycle

### Requirement: Session creation errored semantics are preserved

LinkTerm SHALL characterize the current distinction between IPC request success and a newly registered session whose transport open attempt ends in `errored`.

#### Scenario: Session opens successfully

- **WHEN** `session:create` receives a valid request and the created session opens successfully
- **THEN** the IPC result is successful and contains the registered `sessionId` with state `open`

#### Scenario: Session open fails after registration

- **WHEN** `session:create` receives a valid request, the session is registered, and `session.open()` fails
- **THEN** the current IPC result remains `success: true`
- **AND** its data contains the registered `sessionId` and state `errored`
- **AND** the registered errored session remains available to existing UI/session lifecycle code

#### Scenario: Session registration fails before a session exists

- **WHEN** session construction or manager registration throws before a usable session is registered
- **THEN** `session:create` returns the current structured `INTERNAL` failure
- **AND** it does not report an opened or errored session as successful

#### Scenario: MCP session open failure rolls back registration

- **WHEN** MCP `open_session` creates a candidate session and its transport open fails
- **THEN** it returns the current structured `INTERNAL` failure without a successful session result
- **AND** `SessionManager` retains no ghost session or visible session metadata
- **AND** no `session:created` or `session:destroyed` lifecycle event is emitted for the failed candidate
- **AND** no candidate `session:event` is forwarded

#### Scenario: Renderer and MCP compatibility paths remain distinct

- **WHEN** Phase 0 compares the same open-failure class through Renderer `session:create` and MCP `open_session`
- **THEN** Renderer retains the registered `errored` session under its current success envelope
- **AND** MCP rolls its candidate back and returns a structured failure
- **AND** Phase 0 does not attempt to unify or redesign either path

### Requirement: Control workflow job update semantics are preserved

LinkTerm SHALL characterize `ControlWorkflowJobManager` update, cancellation, terminal-state, and retention behavior without adding a second job system or changing hardware execution.

#### Scenario: Running job receives partial workflow evidence

- **WHEN** `update(jobId, workflow)` is called for an existing running job
- **THEN** the manager copies the workflow object, steps, step errors, summary, next actions, and blocking reasons that its current clone boundary explicitly owns
- **AND** `currentStepId` becomes the last recorded step identifier
- **AND** `updatedAt` advances while the job remains non-terminal

#### Scenario: Caller mutates an explicitly cloned workflow structure after update

- **WHEN** the caller changes the workflow object, steps array, a step or step error, summary, next-actions array or item, or blocking-reasons array or item after passing it to `update`
- **THEN** subsequent status and evidence reads retain the values captured for those explicitly cloned structures
- **AND** Phase 0 does not claim that arbitrary nested payloads such as a step's `evidence` object are deeply cloned

#### Scenario: A second active job is rejected

- **WHEN** a caller attempts to create a job while another job remains `queued` or `running`
- **THEN** creation fails with the current structured `INVALID_STATE` error
- **AND** no competing job record or runner is started

#### Scenario: Runner reports a failed workflow step

- **WHEN** the runner resolves with workflow evidence containing `failedStep`
- **THEN** the job reaches `failed` with that evidence and its last step as `currentStepId`

#### Scenario: Runner throws a non-abort error

- **WHEN** the runner throws a `ToolError` or unexpected exception without a cancellation request
- **THEN** the job reaches `failed`
- **AND** its retained workflow ends in a structured `job_failed` step using the stable `ToolError` code or `INTERNAL`

#### Scenario: Queued job is cancelled

- **WHEN** `cancel` is called before a queued job starts
- **THEN** the job immediately reaches `cancelled`
- **AND** it retains a terminal `job_cancelled` step with `ABORTED`

#### Scenario: Running job is cancelled

- **WHEN** `cancel` is called for a running job
- **THEN** the current cancellation response remains `running` with `cancelRequested: true` and its `AbortSignal` is aborted
- **AND** runner completion or abort handling moves the job to terminal `cancelled` while preserving prior partial evidence

#### Scenario: Terminal cancellation is idempotent

- **WHEN** `cancel` is called for a job already in `succeeded`, `failed`, or `cancelled`
- **THEN** it returns the existing terminal snapshot without changing evidence, timestamps, or starting work

#### Scenario: Default completed-job TTL is applied

- **WHEN** a terminal job reaches 30 minutes after `completedAt` under the production default
- **THEN** status, read, list, cancel, or expired cleanup can remove it and subsequent lookup returns `NOT_FOUND`
- **AND** queued and running jobs do not expire under this TTL

#### Scenario: Runner completion enforces the default retained-job cap

- **WHEN** a runner-started job reaches a terminal state while more than 32 terminal jobs are retained under the production default
- **THEN** terminal records with the oldest `updatedAt` are removed until 32 remain
- **AND** active queued or running jobs are not counted or removed by the retained-job cap

#### Scenario: Queued cancellation does not immediately enforce the retained-job cap

- **WHEN** repeated queued jobs are cancelled without a later runner-started job reaching terminal state or an explicit cleanup call
- **THEN** the current manager can temporarily retain more than 32 terminal records
- **AND** Phase 0 records this as a compatibility limitation rather than claiming eager cap enforcement or changing product behavior

#### Scenario: Explicit cleanup preserves active jobs

- **WHEN** cleanup targets all jobs, expired jobs, or a specific active job
- **THEN** matching terminal jobs may be removed
- **AND** an active job is not removed unless its normal cancellation lifecycle first makes it terminal

#### Scenario: Job lifecycle tests remain hardware-free

- **WHEN** Phase 0 verifies all job lifecycle scenarios
- **THEN** tests use deterministic clocks, identifiers, and fake runners rather than real hardware

### Requirement: Every production MCP tool has a reviewed risk-inventory entry

LinkTerm SHALL maintain a versioned, reviewable inventory that classifies every production MCP tool as exactly one of `read-only`, `state-affecting`, `disruptive`, or `destructive-or-unknown` without using the inventory as runtime authorization in Phase 0. Production tools SHALL use the statically reviewable central `registerTool` convention defined below; alternate SDK, re-exported, dynamically imported, or runtime-generated registration is prohibited unless a later reviewed change replaces this validator and its evidence model.

#### Scenario: Inventory matches production registration

- **WHEN** the inventory validator scans all production `.ts` and `.tsx` files under `src`, resolves supported relative named-import aliases and direct namespace members to the unique `src/mcp/registry.ts` source behind `registry.js`, and accepts direct literal `registerTool` definitions only inside a first-level directory under `src/mcp/surfaces`
- **THEN** the inventory contains exactly the same 63 unique static registration definitions with no missing or extra entry
- **AND** each entry records its surface, declared registry sensitivity, risk level, current acknowledgement policy, unassigned future approval policy, and a non-empty rationale

#### Scenario: A registry binding escapes the supported registration form

- **WHEN** an import whose original or local name is `registerTool` does not resolve through the unique relative central `registry.js` module, or that central binding is assigned to a local alias, hidden behind a wrapper or non-literal definition, escaped from a namespace through aliasing, binding/assignment destructuring, or computed access, re-exported (including extensionless star/namespace forms), dynamically imported, or invoked outside a valid surface directory
- **THEN** the inventory validator fails closed instead of silently omitting the possible registration
- **AND** direct or destructured SDK `.registerTool` access is rejected everywhere except the single fixed-shape `server.registerTool(def.name, ...)` bridge in `src/mcp/registry.ts`, while direct, computed, or destructured legacy SDK `.tool` access is rejected everywhere
- **AND** the central file must expose exactly one `registerTool` function, may not alias or forward that entry, and must contain exactly one fixed-shape SDK bridge
- **AND** symbolic links anywhere in the scanned production source tree are rejected rather than silently skipped

#### Scenario: Tool registration changes without inventory review

- **WHEN** a supported static production registration definition is added, removed, renamed, or changes declared sensitivity without the inventory being updated
- **THEN** the deterministic inventory test fails and identifies the mismatch
- **AND** this static-definition check does not claim to prove runtime reachability, detect removal of server wiring, or recognize arbitrarily obfuscated or generated registration; those forms remain prohibited and require separate review if the registration architecture changes

#### Scenario: A currently characterized acknowledgement path changes

- **WHEN** acknowledgement behavior changes for the seven-tool low-level matrix, `run_control_workflow`, or `restart_mcp_runtime` without corresponding inventory and behavior-test review
- **THEN** the exact acknowledgement-set assertion or the parameterized runtime behavior matrix fails
- **AND** the AST scan does not claim to infer acknowledgement from schemas, handler text, or a `confirm` property

#### Scenario: A new acknowledgement path is introduced elsewhere

- **WHEN** a production handler outside the explicitly characterized acknowledgement paths introduces or removes an acknowledgement guard
- **THEN** Phase 0 requires manual consequence review plus an inventory update and a new executable behavior test
- **AND** the change is not claimed to be generically detectable from schemas, handler bodies, or a `confirm` property by the name-and-sensitivity AST scan

#### Scenario: Inventory contains an unknown risk value

- **WHEN** an inventory entry lacks a risk or uses a value outside the four allowed levels
- **THEN** validation fails closed
- **AND** no fallback infers authorization from `sensitivity` or `confirm=true`

#### Scenario: Conditional workflow acknowledgement is represented

- **WHEN** the inventory describes `run_control_workflow`
- **THEN** its current acknowledgement policy is conditional rather than conflated with the seven-tool low-level matrix
- **AND** `restart_mcp_runtime` is represented as a separately guarded MCP tool while direct Download remains an explicitly documented non-MCP IPC path

#### Scenario: Phase 0 inventory is consumed

- **WHEN** LinkTerm runs in Phase 0
- **THEN** the inventory remains review data and a test fixture
- **AND** it does not introduce runtime RiskPolicy, approval grants, admission leases, or new execution permission

### Requirement: Clean-checkout CI enforces repository quality gates

LinkTerm SHALL provide non-interactive CI that installs the frozen dependency graph and enforces lint, production build, full automated tests, and license validation on supported desktop operating systems.

#### Scenario: Quality workflow runs from a clean checkout

- **WHEN** CI runs on Windows, Ubuntu Linux, or macOS with Node.js 22.13.0 and pnpm 9.15.0
- **THEN** dependencies are installed with `pnpm install --frozen-lockfile`
- **AND** lint, `pnpm run build`, the full Vitest suite, and `pnpm run validate:licenses` must each succeed

#### Scenario: Workflow dependencies remain least privilege and reviewable

- **WHEN** the quality workflow checks out source or invokes a third-party Action
- **THEN** each Action reference uses a reviewed full commit SHA rather than a mutable tag
- **AND** repository permissions remain read-only and checkout does not persist credentials

#### Scenario: Native dependencies are installed in CI

- **WHEN** the clean-checkout workflow installs Electron, serial, terminal, Rolldown, or Tailwind native packages
- **THEN** it uses the platform-specific install result rather than sharing `node_modules` across operating systems
- **AND** the existing WSL/native-dependency doctor remains part of the test path where applicable

#### Scenario: CI verifies behavior without hardware

- **WHEN** the quality workflow runs
- **THEN** tests use mocks, fakes, or null backends
- **AND** CI performs no real serial open, probe attach, erase, flash, reset, GDB-server, RTT, or other hardware side effect

### Requirement: Coverage is reported before thresholds are enforced

LinkTerm SHALL provide a pinned, non-interactive V8 coverage report for the repository source tree and SHALL NOT introduce a global coverage threshold in Phase 0.

#### Scenario: Coverage command runs locally and in CI

- **WHEN** `pnpm run test:coverage` is executed after a frozen install
- **THEN** the complete automated test suite runs with the Vitest V8 provider version aligned to Vitest
- **AND** text, JSON summary, HTML, and LCOV reports are produced under the ignored `coverage/` directory

#### Scenario: Coverage tooling licenses are audited without changing runtime scope

- **WHEN** `@vitest/coverage-v8` is declared as a development dependency
- **THEN** license validation requires a separate audited development-tooling record for the installed root and its exact production-dependency closure
- **AND** every closure record has a matching resolved name, version, license identifier, and repository license file
- **AND** the existing runtime dependency count remains separate rather than classifying coverage tooling as shipped runtime code

#### Scenario: Coverage tooling dependency closure drifts

- **WHEN** an installed package is added to, removed from, or version/license-changed within the coverage root's package `dependencies` closure without a matching audited record
- **THEN** license validation fails with the exact missing, unexpected, or mismatched package evidence
- **AND** peer dependencies, package development dependencies, and uninstalled optional peers are not claimed as part of that production closure

#### Scenario: Coverage artifact is published

- **WHEN** the Linux coverage job succeeds
- **THEN** CI uploads the generated coverage directory as a finite-retention build artifact
- **AND** no third-party analytics, telemetry, or cloud coverage account is required

#### Scenario: Phase 0 coverage is evaluated

- **WHEN** coverage percentages are lower than a future desired target
- **THEN** Phase 0 still reports the measured baseline without silently excluding uncovered LinkTerm source areas
- **AND** no numeric global threshold is added until a later reviewed change defines one

### Requirement: GitNexus governance is documented and evidenced

LinkTerm SHALL document the mandatory GitNexus checks used to plan, review, and close implementation phases.

#### Scenario: Clean checkout enables directed analysis

- **WHEN** the repository is checked out without local-only configuration
- **THEN** the versioned `.gitnexusrc` enables `pdg: true`
- **AND** the setting does not make zero PDG or taint findings sufficient proof of safety

#### Scenario: Existing symbol is about to be edited

- **WHEN** a function, class, or method is selected for modification
- **THEN** upstream impact is run against the fresh repository index before editing
- **AND** HIGH or CRITICAL risk, direct dependents, affected processes, and affected modules are reported before proceeding

#### Scenario: PDG or taint reports no finding

- **WHEN** a directed PDG/taint review returns zero persisted findings
- **THEN** the result is recorded as limited evidence rather than proof of safety
- **AND** targeted tests and trust-boundary review remain required

#### Scenario: Phase changes are ready for completion review

- **WHEN** Phase 0 implementation and verification are otherwise complete
- **THEN** `detect_changes` is run against the expected base and reviewed for unintended symbols or execution flows
- **AND** the phase is not reported complete until OpenSpec, tests, build, license, coverage-report, and worktree-scope evidence are fresh

### Requirement: Phase 0 does not change product behavior

Phase 0 SHALL limit implementation to characterization tests, review data, development dependencies, CI/configuration, and governance documentation.

#### Scenario: Phase 0 diff is reviewed

- **WHEN** the completed Phase 0 change is compared with its base
- **THEN** no production runtime handler, user-facing API, trust boundary, preload DTO, Renderer behavior, transport, manager, `SessionManager`, `WriteQueue`, or `IJLinkBackend` behavior has changed
- **AND** no Phase 1–8 feature is implemented early
