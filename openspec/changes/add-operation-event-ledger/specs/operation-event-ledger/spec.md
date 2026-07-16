## ADDED Requirements

### Requirement: Operation and CallAttempt identities are server-owned and distinct
LinkTerm SHALL represent a user-understandable logical goal with a server-generated `operationId` and each MCP invocation that passes SDK validation with a separately server-generated `callId`. Client-supplied ids, correlation ids, display names, transport hints, and arguments MUST NOT select or overwrite either identity. A call lifecycle owns an independent finish-once guard: it makes exactly one terminal decision/emission attempt even if the best-effort ledger cannot retain that attempt.

#### Scenario: Ordinary MCP call enters the LinkTerm wrapper
- **WHEN** a production MCP invocation passes the SDK input schema and enters the central `registerTool` callback
- **THEN** LinkTerm creates one new logical operation and one new call attempt using server-generated ids
- **AND** the first accepted `call-transition` binds that `callId` to exactly one `operationId`

#### Scenario: Two invocations carry the same client correlation id
- **WHEN** two ordinary calls enter the wrapper with the same client-provided `correlationId`
- **THEN** each call receives a different `callId` and a different `operationId`
- **AND** the correlation id is treated only as a sanitized display/grouping hint

#### Scenario: Future approval retry fixture reuses a logical operation
- **WHEN** the Phase 1 state-machine fixture creates an approval-required first call and a later retry selected through a trusted server-side operation reference
- **THEN** both attempts have different `callId` values and independent terminal call phases
- **AND** both attempts retain the same logical `operationId`
- **AND** no Phase 1 production request can select that operation by supplying an `operationId` or `approvalId`

#### Scenario: Capture fails while a call terminalizes
- **WHEN** a call makes its terminal decision but redaction, schema validation, append, or capacity prevents the terminal event from being retained
- **THEN** the call's finish-once guard is still consumed exactly once
- **AND** no later return, throw, or cleanup path can make a second terminal decision
- **AND** an independent bounded `captureFailureCount` and safe failure-stage code increase without querying the failed ledger append

### Requirement: Operation and CallAttempt use separate monotonic state machines
LinkTerm SHALL validate logical-operation transitions independently from per-call transitions. A logical terminal phase MUST remain terminal. Each call lifecycle SHALL make exactly one terminal decision from `approval-required`, `succeeded`, `failed`, or `rejected`, and the ledger MUST accept at most one terminal call-transition event for a `callId`. After a healthy ledger accepts a terminal and while that lifecycle remains inside the retained window, it MUST expose exactly one queryable terminal; normal eviction ends that time-bounded query guarantee and MUST be visible through truncation, oldest-available, and eviction evidence.

#### Scenario: Ordinary call succeeds
- **WHEN** an ordinary call is admitted to its handler and produces its existing successful result
- **THEN** its CallAttempt progresses `received → started → succeeded`
- **AND** its logical Operation progresses `requested → running → succeeded`
- **AND** exactly one retained event for that `callId` contains a terminal call phase

#### Scenario: Admitted handler fails or throws
- **WHEN** an admitted handler returns its existing structured failure or throws an exception that the registry normalizes
- **THEN** its CallAttempt progresses `received → started → failed`
- **AND** its logical Operation progresses `requested → running → failed`
- **AND** the returned MCP result and normalized error remain byte-for-byte compatible apart from nondeterministic pre-existing data

#### Scenario: Business effect succeeds but response construction fails
- **WHEN** an admitted handler returns a successful business result but payload construction or `CallToolResult` serialization throws before delivery
- **THEN** the logical Operation terminal decision remains `succeeded`
- **AND** the CallAttempt terminal decision is `failed` with safe stage `response-construction` or `response-serialization`
- **AND** LinkTerm rethrows the same delivery failure behavior and does not retry or relabel the completed effect

#### Scenario: Known pre-admission guard rejects a call
- **WHEN** the central wrapper rejects a call for version mismatch or stale runtime, or a currently characterized acknowledgement gate returns `CONFIRMATION_REQUIRED` before its guarded backend
- **THEN** its CallAttempt progresses `received → rejected` without `started`
- **AND** its logical Operation progresses `requested → rejected` without `running`
- **AND** the handler/backend invocation counts remain identical to the Phase 0 characterization

#### Scenario: Approval is required in the future-state fixture
- **WHEN** a fixture call reaches the future approval-required transition
- **THEN** its CallAttempt progresses `received → approval-required` and is terminal for that call
- **AND** its logical Operation remains non-terminal in `awaiting-approval`
- **AND** no `running` or `started` phase is emitted for that attempt

#### Scenario: Pending approval is retried in the future-state fixture
- **WHEN** a synthetic pending retry is resolved through the server-owned pending operation reference
- **THEN** it receives a new `callId` associated with the original `operationId`
- **AND** the new CallAttempt progresses `received → approval-required`
- **AND** the logical Operation remains `awaiting-approval`

#### Scenario: Approved retry executes in the future-state fixture
- **WHEN** a synthetic approved retry is admitted through the server-owned fixture
- **THEN** it receives a third unique `callId` associated with the original `operationId`
- **AND** the CallAttempt progresses `received → started → succeeded`
- **AND** the Operation progresses `awaiting-approval → queued → running → succeeded`

#### Scenario: Synthetic approved retries race
- **WHEN** duplicate or concurrent synthetic retries target the same future approval fixture
- **THEN** at most one retry can make the execution decision
- **AND** all other attempts reach their own rejected terminal without changing the winning Operation terminal
- **AND** this fixture does not create a Phase 1 production continuation

#### Scenario: Synthetic approval is resolved but not retried
- **WHEN** the future fixture marks an approval decision but no new CallAttempt arrives
- **THEN** the Operation does not enter `queued`, `running`, or an execution terminal
- **AND** human resolution itself is not modeled as backend execution

#### Scenario: Synthetic approval is paused or reaches TTL
- **WHEN** a future fixture is approved while synthetically paused, or its blocked/awaiting TTL expires
- **THEN** pause leaves it non-admitted in `blocked` until synthetic resume/revalidation
- **AND** TTL maps it to `expired` without a started CallAttempt
- **AND** a new semantic intent maps the old Operation to `superseded` rather than reusing it

#### Scenario: Caller acknowledgement changes from false to true
- **WHEN** an existing acknowledgement-gated action is invoked first without `confirm: true` and then with `confirm: true`
- **THEN** the two invocations receive different `callId` and `operationId` values
- **AND** the first Operation is rejected rather than reused by the second invocation

#### Scenario: A later attempt fails after an operation is terminal
- **WHEN** a duplicate or later CallAttempt is associated with an already terminal logical Operation
- **THEN** the attempt can reach its own terminal call phase
- **AND** it cannot replace, regress, or reinterpret the logical Operation terminal phase

#### Scenario: Invalid or duplicate transition is proposed
- **WHEN** a producer proposes an illegal transition, changes a `callId` association, or proposes a second terminal phase for one CallAttempt
- **THEN** the event is rejected before entering the ledger
- **AND** a bounded health diagnostic count is increased without changing product behavior

#### Scenario: Call-only transition is reduced
- **WHEN** a `call-transition` event is processed
- **THEN** it has a mandatory `callId` and closed `callPhase`
- **AND** it carries no reducible Operation phase and cannot alter the Operation reducer

#### Scenario: Operation-only transition is reduced
- **WHEN** an `operation-transition` event is processed
- **THEN** it carries a closed Operation phase and no `callPhase`
- **AND** it cannot create, advance, or terminalize a CallAttempt

#### Scenario: Workflow milestone is reduced
- **WHEN** a `workflow-milestone` event is processed
- **THEN** it references an existing workflow Operation and carries no Operation or CallAttempt phase
- **AND** queued/running/terminal state changes use separate `operation-transition` events
- **AND** the milestone can update only bounded progress/evidence-reference fields

#### Scenario: Runtime-end classification is evaluated
- **WHEN** graceful runtime-end recovery is applied to an unterminated Operation
- **THEN** `requested` maps to `rejected` with reason `runtime-ended-before-admission`
- **AND** `awaiting-approval` or `blocked` maps to `expired` with reason `runtime-restart`
- **AND** `queued`, `running`, or `cancel-requested` maps to `interrupted`
- **AND** an existing terminal Operation remains unchanged

### Requirement: Operation events use strict versioned internal and display contracts
Every retained activity event and every IPC-exposed activity view SHALL validate against separate strict schema version `1.0.0` contracts. Every event variant and materialized Operation view SHALL carry server runtime/event/operation identity, timestamp, server-owned actor, closed surface, stable action code, reviewed risk, descriptive approval policy, and at least one display-safe target; every Operation view/transition SHALL also carry its logical phase, while every call transition SHALL carry its independent `callId`/`callPhase`. Retained events SHALL use a closed discriminated union: `operation-transition` changes only logical Operation state, `call-transition` changes only one CallAttempt, and `workflow-milestone` adds bounded progress to one workflow Operation without acting as a call transition. `(runtimeId, sequence)` is the sole ordering key; timestamps are display data only. An explicit mapper SHALL construct `ActivityEventView` without object spread from an internal event.

#### Scenario: A valid event is appended
- **WHEN** a recorder submits a valid event draft
- **THEN** the ledger supplies the current `runtimeId`, next sequence, server event id, and timestamp
- **AND** the stored event contains no mutable reference to producer-owned input

#### Scenario: Internal event becomes an IPC view
- **WHEN** a retained event is projected for preload
- **THEN** a dedicated allowlist mapper constructs a strict `ActivityEventView`
- **AND** internal argument digests, failure objects, policy internals, health sink state, and any field not declared by the view schema are absent

#### Scenario: Event contains an unknown key or unsafe value shape
- **WHEN** an event, target, progress object, error object, or argument summary contains an undeclared key, unsupported value type, excessive depth, or value beyond its configured bound
- **THEN** strict schema validation rejects it
- **AND** the rejected payload is not echoed into a health diagnostic

#### Scenario: Events arrive with out-of-order timestamps
- **WHEN** timestamps are equal, delayed, or earlier than a previously appended timestamp
- **THEN** reducers and hydration still order exclusively by the strictly increasing runtime sequence
- **AND** timestamp values cannot regress state

#### Scenario: Actor information comes from an MCP call
- **WHEN** the registry records an MCP invocation
- **THEN** actor kind/channel are fixed to the server-owned local MCP Agent display identity
- **AND** HTTP versus stdio is at most an advisory transport hint
- **AND** no actor field is treated as a `CallerPrincipalId` or authorization subject

#### Scenario: Ordinary MCP metadata is derived
- **WHEN** an MCP tool lifecycle event or materialized Operation view is created
- **THEN** action is the exact stable tool name and actor is the server-owned local MCP Agent
- **AND** surface, risk, descriptive approval policy, target rules, and any current acknowledgement rule come from the exact reviewed tool policy rather than raw arguments
- **AND** targets are non-empty and fall back to the current opaque runtime target when no more specific safe target exists

#### Scenario: MCP child workflow-job metadata is derived
- **WHEN** an MCP background workflow creates its separate child job Operation
- **THEN** actor is inherited from the trusted recorder context, surface is `workflow`, action is `control-workflow.job`, risk is `destructive-or-unknown`, and descriptive approval policy is `human-once`
- **AND** targets include the opaque job id and may include only a redacted workspace basename/alias
- **AND** authorization source remains `none` in Phase 1

#### Scenario: Direct Main workflow-job metadata is derived
- **WHEN** trusted Main `CONTROL_PROFILE_START_DOWNLOAD` creates its separate job Operation
- **THEN** actor is Main-assigned `human`, surface is `control-profile`, action is `control-profile.download-job`, risk is `destructive-or-unknown`, and descriptive approval policy is `human-once`
- **AND** targets include the opaque job id and may include only a redacted workspace basename/alias
- **AND** current hard-coded caller acknowledgement is not represented as a human grant and authorization source remains `none`

#### Scenario: Current caller acknowledgement is recorded
- **WHEN** an existing high-impact tool receives `confirm: true`
- **THEN** the display-safe event may record `clientAcknowledged: true`
- **AND** `authorizationSource` remains `none`
- **AND** the event does not claim a human grant or automation authorization

### Requirement: The runtime risk policy is complete and conservative
LinkTerm SHALL resolve every one of the 63 Phase 0 production tool names to one reviewed surface, declared sensitivity, four-level risk, current acknowledgement rule, future approval-display policy, and redaction policy. The runtime projection and `docs/security/mcp-tool-risk-inventory.json` SHALL be checked for exact name and classification agreement.

#### Scenario: All current production tools are checked
- **WHEN** the runtime risk-policy completeness test compares registered definitions, the reviewed JSON inventory, and the TypeScript policy
- **THEN** all three sets contain exactly the same 63 unique names
- **AND** sensitivity, surface, risk, and current acknowledgement classification agree for every tool

#### Scenario: Unknown tool is classified
- **WHEN** a tool name is absent from the runtime policy
- **THEN** observation classifies it as `destructive-or-unknown` with metadata-only redaction and future `human-once` policy
- **AND** it records a policy health diagnostic rather than silently treating the action as read-only
- **AND** Phase 1 still does not introduce or enforce a new authorization decision

#### Scenario: Registry sensitivity and policy drift
- **WHEN** the `ToolDefinition.sensitivity` disagrees with the reviewed policy
- **THEN** the recorder uses the more conservative `destructive-or-unknown` observation classification
- **AND** the completeness test fails with the exact tool mismatch
- **AND** the ordinary business handler remains governed by the existing product contract

#### Scenario: Conditional workflow acknowledgement is evaluated
- **WHEN** `run_control_workflow` is a dry run
- **THEN** the recorder does not predict a missing-acknowledgement rejection
- **AND** for every currently schema-valid non-dry-run mode it predicts the existing acknowledgement gate without moving that gate into the recorder

### Requirement: Sensitive information is removed before ledger append
The recorder SHALL pass raw arguments, result metadata, workflow updates, and errors through an allowlist-first `AuditRedactor` before creating an event draft. Neither the in-memory ledger nor the activity IPC SHALL contain raw credentials, secrets, arbitrary evidence bodies, terminal data, full scripts, absolute paths, screenshots, firmware/binary bytes, base64 bodies, or memory-write values.

#### Scenario: Credentials and secrets are present
- **WHEN** input includes password, private key, passphrase, token, authorization, cookie, secret environment values, nonce, or similarly protected fields at any tested nesting level
- **THEN** neither the value nor a reversible encoding or low-entropy digest of that value appears in serialized ledger or IPC output
- **AND** only a bounded category/count marker may indicate that protected input was omitted

#### Scenario: Path value is summarized
- **WHEN** an explicitly policy-allowlisted path field is summarized
- **THEN** the default event contains at most a sanitized basename or opaque alias
- **AND** drive, home, workspace, WSL host, and parent-directory components are absent

#### Scenario: Script or binary-like value is summarized
- **WHEN** an explicitly policy-allowlisted Commander script, firmware/binary/base64, screenshot, terminal body, or memory payload is summarized
- **THEN** the event contains only bounded type/size/hash metadata permitted for that category
- **AND** any digest identifies its basis and is never presented as device verification or authorization
- **AND** no content prefix, decoded bytes, command line, or screenshot pixels are retained

#### Scenario: Arbitrary handler evidence or error details are returned
- **WHEN** a handler returns `ToolEvidence.data`, `evidence.meta`, an error message, or `error.details` containing a protected fixture
- **THEN** the activity event stores only approved evidence references and stable error/message codes
- **AND** the raw data, message, details, stack, and object graph are absent

#### Scenario: Unknown field is encountered
- **WHEN** an argument or workflow field has no explicit summary rule
- **THEN** its value is omitted rather than recursively copied
- **AND** metadata-only field/count information cannot contain user-controlled nested keys or values

#### Scenario: Redaction property fixtures run
- **WHEN** nested, cyclic, very large, binary, base64-shaped, path-shaped, and randomly generated protected fixtures are redacted
- **THEN** the redactor terminates within configured depth/size bounds
- **AND** serialized output contains none of the seeded protected values

#### Scenario: Accessor or Proxy input is presented
- **WHEN** an allowlisted object position contains an accessor property or a Node-detectable Proxy
- **THEN** redaction invokes neither the accessor getter nor any Proxy ownKeys/get/getOwnPropertyDescriptor trap
- **AND** the object is omitted before enumeration/property inspection and a safe category count may increase
- **AND** no error or diagnostic includes object content

### Requirement: The in-memory ledger is bounded, queryable, and cursor-correct
`OperationLedger` SHALL maintain a runtime-scoped, append-only in-memory projection with default bounds of 5,000 events, 1,000 tracked logical operations, 2,000 tracked CallAttempts, and an explicit total activity-state byte budget covering internal retained events, reducer records, and materialized views. It SHALL expose snapshots/read-since results containing strict `ActivityEventView` items, materialized non-terminal `OperationView` and `CallAttemptView` projections, current cursor, truncation/reset status, oldest available cursor when applicable, runtime-cumulative `droppedEventCount` for candidates never retained, runtime-cumulative `evictedEventCount` for committed prefix removals, and bounded capture/listener/policy health counters. `incompleteLifecycleCount` SHALL be a current gauge of wrapper entries that have not yet made their first finish-once terminal decision; event retention and eviction SHALL NOT change that gauge. Active projections MUST NOT be silently lost solely because their early events leave the ring.

#### Scenario: Events are appended normally
- **WHEN** valid events are appended within capacity
- **THEN** sequence values increase by exactly one within the current `runtimeId`
- **AND** a read from cursor N returns retained events with sequence greater than N in ascending order
- **AND** the returned cursor equals the latest accepted sequence

#### Scenario: One lifecycle step needs multiple reducer events
- **WHEN** begin, start, approval-required, rejected, success, or failure needs paired Operation and CallAttempt transitions
- **THEN** the ledger preflights and commits the ordered batch atomically with contiguous sequences
- **AND** capacity, schema, or transition failure rejects the entire batch without leaving an orphan Operation or CallAttempt

#### Scenario: Event capacity is exceeded
- **WHEN** appending an event exceeds the event-count or total-state byte bound and evictable history exists
- **THEN** the oldest necessary retained history is evicted predictably
- **AND** `evictedEventCount` increases by the exact number of previously retained events removed while `droppedEventCount` does not change
- **AND** a reader whose cursor precedes retained history receives `truncated: true` and `oldestAvailable`

#### Scenario: Tracked-operation capacity is exceeded
- **WHEN** tracked-operation capacity would be exceeded
- **THEN** the ledger evicts only the minimum oldest event prefix needed to release a terminal Operation record and satisfy the operation limit
- **AND** non-terminal Operation/CallAttempt projections remain pinned while capture is healthy
- **AND** if no terminal record can be released, the new observation is dropped with capture health evidence, `droppedEventCount` increases by the candidate event count, and business execution continues

#### Scenario: CallAttempt or total-state capacity is exceeded
- **WHEN** a new `callId` would exceed the tracked-CallAttempt limit or the accounted total-state byte budget after all permissible minimum-prefix eviction
- **THEN** the full begin batch is rejected before any Operation/Call reducer or materialized view is committed
- **AND** its recorder handle becomes finish-once no-op capture state so later lifecycle calls do not create cascading capture failures
- **AND** `droppedEventCount` increases by the full candidate batch size while `evictedEventCount` changes only for a committed prefix eviction
- **AND** business admission and execution remain governed only by the existing product behavior

#### Scenario: Long-running operation loses early events
- **WHEN** capacity eviction removes the requested/received history of a still-active operation
- **THEN** the snapshot still includes its materialized current Operation and CallAttempt views
- **AND** the event window reports truncation rather than pretending to contain the complete lifecycle

#### Scenario: Reader cursor is current
- **WHEN** a snapshot request supplies the current runtime and latest sequence
- **THEN** it receives no duplicate events, `truncated: false`, and the unchanged current cursor

#### Scenario: Empty ledger is queried
- **WHEN** the first snapshot is requested before any event or health failure
- **THEN** it returns the current runtime with sequence `0`, empty events and active views, `truncated: false`, and `resetRequired: false`
- **AND** `oldestAvailable` is absent and all drop/capture/eviction counters are zero

#### Scenario: Initial reader arrives after eviction
- **WHEN** a snapshot without a cursor is requested after runtime history has been evicted
- **THEN** it receives the retained window and active materialized views with `truncated: true`
- **AND** `oldestAvailable` and `evictedEventCount` show that the window is not complete history

#### Scenario: Reader belongs to an older runtime
- **WHEN** a cursor has a different `runtimeId`
- **THEN** the current runtime returns its retained window with `truncated: true`
- **AND** the snapshot declares reset-required semantics for that consumer
- **AND** no sequence from the old runtime is interpreted as current

#### Scenario: Cursor is malformed or ahead of the current runtime
- **WHEN** a cursor has an invalid runtime id, non-integer/negative sequence, unknown fields, or a same-runtime sequence greater than the ledger cursor
- **THEN** core validation or IPC returns a stable structured rejection
- **AND** no subscription or ledger state is changed by the malformed cursor

#### Scenario: Cursor is at the oldest no-gap boundary
- **WHEN** a same-runtime cursor equals `oldestAvailable.sequence - 1`
- **THEN** the reader receives the full retained suffix with `truncated: false`
- **AND** `droppedEventCount` is treated as a runtime cumulative metric rather than a sequence number

#### Scenario: Runtime sequence approaches numeric exhaustion
- **WHEN** the next sequence would exceed `Number.MAX_SAFE_INTEGER`
- **THEN** the ledger rotates to a new server-generated runtime id and resets the retained window before accepting another event
- **AND** existing cursors observe the same reset-required runtime-mismatch contract

#### Scenario: Subscriber throws or unsubscribes
- **WHEN** one ledger subscriber throws while processing an event or later unsubscribes
- **THEN** other subscribers continue receiving ordered events
- **AND** the throwing listener increases a bounded health counter without escaping append
- **AND** the unsubscribed listener receives no later callback

### Requirement: Observability remains best effort and cannot change execution outcomes
Operation recording, redaction, ledger append, subscriber delivery, and activity IPC SHALL be observation-only. Any failure in those components MUST NOT convert an existing success to failure, convert a failure to success, retry a handler/backend, authorize an action, or alter a job transition.

#### Scenario: Recorder or ledger fails around a successful handler
- **WHEN** an injected recorder provider throws, redaction fails, append rejects, capacity evicts, or an IPC listener fails while the business handler succeeds
- **THEN** the existing MCP `CallToolResult` remains unchanged
- **AND** the handler and backend are invoked exactly once
- **AND** a safe local health counter records the observation failure when possible

#### Scenario: Capture completeness is evaluated for release
- **WHEN** Phase 1 completion evidence is assembled
- **THEN** every entered test invocation has one terminal decision and the ledger has accepted at most one terminal per call
- **AND** capture-failure, dropped-event, eviction, and incomplete-lifecycle counts are all zero for the normal acceptance run
- **AND** isolated small-capacity pressure tests are reported separately and do not weaken the zero-counter normal-run gate
- **AND** a nonzero count fails the Phase 1 observability acceptance metric without changing the already returned business result

#### Scenario: Recorder or ledger fails around a business failure
- **WHEN** observation fails while a handler returns or throws its existing business error
- **THEN** the existing error code/result remains unchanged
- **AND** observation does not retry or mask the error

#### Scenario: Authorization authority is queried
- **WHEN** any Phase 1 component decides whether to append, drop, deliver, or query an activity event
- **THEN** that decision cannot grant or deny execution
- **AND** no ApprovalGrant, AuthorizationRecord, CallerPrincipalId, execution lease, or compensation capability exists in or depends on the ledger

### Requirement: Registry instrumentation covers every entered production handler
The central `registerTool` wrapper SHALL obtain an optional server-scoped recorder provider so all 63 production tool definitions share one instrumentation path without changing their handler signatures. Production Main composition SHALL provide the shared recorder to both direct and HTTP-created MCP servers.

#### Scenario: Version mismatch rejects before handler
- **WHEN** the existing version check rejects a state-affecting call
- **THEN** the call and operation reach their rejected terminals
- **AND** the handler invocation count remains zero
- **AND** the existing response shape, code, warning, and schema version are preserved

#### Scenario: Read-only version warning succeeds
- **WHEN** the existing version policy allows a read-only call with a warning
- **THEN** the call records started and succeeded
- **AND** the existing evidence warning and response remain unchanged

#### Scenario: Stale runtime rejects before handler
- **WHEN** the existing freshness guard rejects a state-affecting call
- **THEN** the call and operation reach rejected terminals without started/running
- **AND** the handler invocation count remains zero
- **AND** the existing `INVALID_STATE` response remains unchanged

#### Scenario: Rejected response cannot be serialized
- **WHEN** a version, stale-runtime, or known acknowledgement rejection has made its Operation/Call rejected terminal decision and construction/serialization of that rejection response then throws
- **THEN** the CallAttempt remains `rejected` and finish-once prevents a later `failed` terminal
- **AND** response-delivery failure increments a safe capture/delivery health stage
- **AND** the wrapper preserves the existing thrown/protocol behavior and invokes no business backend

#### Scenario: Handler-declared failure and normalized throw
- **WHEN** a handler returns failure, throws `ToolError`, throws another `Error`, or throws a non-Error value
- **THEN** each invocation has exactly one failed terminal CallAttempt after started
- **AND** the existing normalized result for that branch is unchanged

#### Scenario: SDK rejects before the LinkTerm callback
- **WHEN** the MCP SDK rejects malformed input before invoking the registered callback
- **THEN** no normal Operation or CallAttempt is fabricated
- **AND** the SDK protocol validation response remains the separate diagnostic evidence
- **AND** the guarded business handler/backend invocation count is zero

#### Scenario: Runtime diagnostics throws before admission
- **WHEN** the injected runtime-freshness provider throws before the business handler starts
- **THEN** the Operation and CallAttempt make rejected terminal decisions with a safe `runtime-precondition` stage
- **AND** the business handler is not invoked
- **AND** the wrapper preserves the existing thrown/protocol behavior

### Requirement: Control workflow jobs produce sanitized lifecycle milestones
The shared `ControlWorkflowJobManager` SHALL notify a best-effort observer after committed create, running, update, cancel-requested, and terminal transitions using a dedicated detached immutable observation envelope whose leaves are primitives, not its existing snapshot/workflow object. `OperationRecorder` SHALL translate these observations into one server-owned logical workflow-job operation with sanitized step/progress milestones and no raw workflow payload.

#### Scenario: Job runs to success
- **WHEN** a job is created, started, updated, and succeeds
- **THEN** its workflow operation progresses through queued, running/progress, and succeeded milestones in manager commit order
- **AND** the manager's returned snapshots and existing timestamps/state remain unchanged

#### Scenario: MCP background launch creates a job operation
- **WHEN** an MCP `run_control_workflow` invocation creates a background job while a trusted recorder context is active
- **THEN** the launch CallAttempt and its ordinary Operation terminalize when the existing handler returns the job reference
- **AND** the JobManager creates a separate long-running workflow Operation whose `parentOperationId` is the server-owned launch Operation
- **AND** later job milestones carry no `callId`

#### Scenario: Direct background download creates a job operation
- **WHEN** trusted Main code handles `CONTROL_PROFILE_START_DOWNLOAD` and creates a JobManager record
- **THEN** only the manager's separate workflow Operation is attributed to `human`
- **AND** the actor value comes from Main-owned internal create metadata rather than Renderer input
- **AND** no other human IPC action is newly instrumented in Phase 1

#### Scenario: Job fails or is cancelled
- **WHEN** a job reaches failed, cancel-requested, or cancelled under existing behavior
- **THEN** the workflow operation records the corresponding phase without claiming rollback or safe cancellation
- **AND** cancellation capability remains outside Phase 1 unless already explicitly available

#### Scenario: Job observer throws
- **WHEN** the configured job observer throws on any transition
- **THEN** create/start/update/cancel returns, AbortSignal behavior, retained workflow evidence, cleanup, and terminal selection remain identical to the characterized manager
- **AND** later job transitions still occur

#### Scenario: Job observer mutates its envelope
- **WHEN** an observer attempts to change its observation object, step array, or safe step summary after notification
- **THEN** the observation is immutable or detached and the mutation cannot change any retained job input, workflow, evidence, state, timestamp, or later snapshot
- **AND** the existing deliberate nested `step.evidence` alias behavior of public JobManager snapshots remains unchanged

#### Scenario: Workflow evidence is projected
- **WHEN** a job snapshot contains workspace roots, workflow input, step evidence, errors, next actions, blocking reasons, or binary/debug data
- **THEN** only approved job id, mode, state, stable step ids/message codes, numeric progress, safe target aliases, and cursor-style evidence references may enter activity
- **AND** complete `RunControlWorkflowInput`, `ControlWorkflowData`, paths, evidence objects, and error details do not cross preload

### Requirement: Main owns one ledger across local MCP transports
The Electron Main composition root SHALL create exactly one runtime-scoped ledger/recorder and inject it into the long-lived direct server, every short-lived HTTP request server, the shared JobManager observer, and activity IPC.

#### Scenario: HTTP request servers are recreated
- **WHEN** multiple authenticated HTTP requests, new sockets, reconnects, or the stdio proxy cause short-lived `McpServer` instances to be created
- **THEN** all entered calls append to the same runtime ledger and monotonic cursor
- **AND** server reconstruction does not reset history or reuse a `callId`

#### Scenario: Renderer reloads
- **WHEN** a BrowserWindow reloads while Main remains alive
- **THEN** the ledger and runtime id remain alive
- **AND** a new activity subscription can hydrate retained history from its cursor

#### Scenario: Main runtime restarts
- **WHEN** a new Main runtime starts
- **THEN** it uses a new runtime id and an empty Phase 1 in-memory ledger
- **AND** it does not claim to recover pre-restart history or persist interrupted work

### Requirement: Activity IPC exposes only validated snapshot and event DTOs
Main and preload SHALL expose stable `activity:subscribe`, `activity:unsubscribe`, `activity:snapshot`, and `activity:event` channels through a narrow `window.linkterm.activity` namespace. Subscription registration SHALL be ordered before the returned snapshot, explicit unsubscribe SHALL remove the Main subscriber idempotently, and all request and response payloads SHALL use the shared strict activity schemas.

#### Scenario: Renderer hydrates without a gap
- **WHEN** Renderer registers its preload event callback and then invokes activity subscribe with an optional cursor
- **THEN** Main registers that `webContents` before reading the snapshot
- **AND** events concurrent with snapshot creation are either present in the snapshot or delivered through the event callback
- **AND** sequence-based deduplication can reduce the combined stream without loss or duplication

#### Scenario: Live events surround the snapshot cut
- **WHEN** events arrive after the listener is installed but before and after the subscribe snapshot returns with cut cursor C
- **THEN** the consumer replaces state from the snapshot, discards buffered events at or below C, and applies buffered events above C in sequence order
- **AND** a detected sequence gap requires read-since or resnapshot instead of silently advancing

#### Scenario: Renderer requests a read-only snapshot
- **WHEN** Renderer invokes the snapshot method without changing subscription state
- **THEN** it receives a validated display-safe snapshot for the requested cursor
- **AND** the query has no effect on operation, job, session, transport, or authorization state

#### Scenario: Renderer unsubscribes or is destroyed
- **WHEN** Renderer removes its local event callback and invokes idempotent Main activity unsubscribe, or the subscribed `webContents` is destroyed
- **THEN** the removed callback receives no later event and Main stops sending to that window
- **AND** Main releases the subscriber reference and skips a window destroyed during send
- **AND** other subscribers remain active

#### Scenario: Malformed IPC payload is received
- **WHEN** a snapshot/subscribe request or pushed event does not match the strict shared schema
- **THEN** Main returns a structured invalid-payload result or preload drops the malformed push before invoking Renderer code
- **AND** protected payload fragments are not included in the error

#### Scenario: Preload receives an invalid invoke response
- **WHEN** Main or a test double returns a success/failure envelope whose activity payload violates the shared schema
- **THEN** the activity-specific preload adapter returns a stable local invalid-payload failure
- **AND** it does not rely on the generic TypeScript-only `ipcRenderer.invoke` cast

#### Scenario: Display-safe boundary is reviewed
- **WHEN** an activity snapshot or event crosses preload
- **THEN** it contains no raw args, handler evidence, workflow object, error details, absolute path, script/body/binary content, manager/backend/transport/Electron handle, credential, token, future PreparedOperation/Grant/AuthorizationRecord/CallerPrincipalId/Lease/CompensationCandidate, nonce, internal digest, or raw rule configuration

#### Scenario: Multiple windows subscribe independently
- **WHEN** two trusted windows subscribe with different cursors and one reloads or is destroyed
- **THEN** each Main subscription and Renderer cursor remains independent
- **AND** cleanup of one window does not advance, remove, or unsubscribe the other

### Requirement: Phase 1 remains a side-channel foundation only
This change SHALL NOT implement the Phase 2 Activity Center UI, Phase 5 human approval/continuation, Phase 7 Pause/Take Over, or Phase 8 durable audit/export/retention. It SHALL NOT change existing user-visible tool semantics or execute real hardware during validation.

#### Scenario: Phase 1 implementation diff is reviewed
- **WHEN** the completed change is compared with its base
- **THEN** no Activity Center component, app-store activity state, approval resolver, grant, admission lease, pause control, JSONL writer, export/clear implementation, database, cloud service, telemetry, or rollback promise is present

#### Scenario: Supported production MCP entry is enumerated
- **WHEN** Phase 1 claims coverage of production MCP handler entries
- **THEN** the covered surface is the Electron Main-owned direct server plus its local HTTP endpoint and stdio proxy, all sharing one recorder
- **AND** the legacy orphaned `src/mcp/stdio-entry.ts` is explicitly documented as unsupported/non-default and is not installed or advertised by current Agent integrations
- **AND** that legacy entry cannot be called supported in a later release unless it first receives its own queryable recorder or delegates to the Main-owned runtime

#### Scenario: Existing business compatibility is checked
- **WHEN** success, handler error, version rejection, stale-runtime rejection, acknowledgement rejection, unexpected throw, and job lifecycle characterization tests run with and without an injected recorder
- **THEN** business result envelopes, error codes, backend counts, job snapshots, and cancellation semantics agree

#### Scenario: Validation runs without hardware
- **WHEN** Phase 1 unit, integration, build, license, coverage, PDG/taint, and scope checks execute
- **THEN** all serial, J-Link, erase, flash, reset, GDB, RTT, terminal-write, and other effectful dependencies are fakes or mocks
- **AND** no real hardware side effect occurs
