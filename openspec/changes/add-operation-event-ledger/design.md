## Context

Phase 0 established characterization and CI around the two shared seams Phase 1 must touch: `registerTool` and `ControlWorkflowJobManager`. The current registry callback is reached only after MCP SDK schema validation, then performs version and runtime-freshness guards, invokes the business handler, normalizes handler exceptions, and serializes the existing result. `ControlWorkflowJobManager` is a Main-owned singleton shared by MCP and direct Control Profile download paths, but it has no observer contract.

Electron Main creates a long-lived direct MCP server and a localhost HTTP owner. The HTTP owner creates a new short-lived `McpServer` for each authenticated request, so constructing a ledger inside `createMcpServer` would fragment history. Existing transcript hydration demonstrates the required event/listener/snapshot ordering and destroyed-`webContents` cleanup, but Activity must use an independent cursor and must never consume terminal transcript cursors.

The A+D package defines Operation as a logical goal and CallAttempt as one invocation. It also requires write-before-ledger redaction, a best-effort in-memory projection, queryable cursor/reload behavior, and a future approval-retry fixture while explicitly postponing production approval continuation until Phase 5 and durable JSONL audit until Phase 8.

## Goals / Non-Goals

**Goals:**

- Give every production MCP callback entry one server-owned call lifecycle with exactly one terminal call phase.
- Keep logical operation state separate so a future approval retry can reuse one server-owned operation without reusing a call id.
- Establish a strict display-safe event/snapshot contract, a complete risk/redaction policy, and an allowlist-first redactor.
- Keep a single bounded in-memory ledger across direct stdio, HTTP requests, Renderer reloads, and JobManager updates.
- Add a typed activity IPC/preload bridge with cursor-correct hydration.
- Preserve every existing tool result, error, confirmation, job, backend, and hardware behavior even if observation fails.

**Non-Goals:**

- Activity Center rendering, grouping, filtering, navigation actions, i18n UI, or app-store integration.
- Human approval, `approval:resolve`, PreparedOperation, grants, principals, authorization records, admission leases, Pause, Stop, Take Over, or production retry continuation.
- Persistent audit, JSONL, export, clear, retention/rotation, startup crash recovery, cloud sync, database, telemetry, or checkpoint/rollback behavior.
- Refactoring existing Control Profile preload DTO debt or copying terminal/debug evidence into activity.

## Decisions

### 1. Put the boundary contract in shared code and keep mutable state in core

Create `src/core/activity/activity-event.ts` with the Main/internal retained-event union and reducer drafts. Create `src/shared/activity-contract.ts` with only strict display-safe Zod schemas and inferred readonly types for:

- `OperationRisk`, `ApprovalPolicy`, `OperationPhase`, and `CallAttemptPhase`;
- `OperationActor`, `OperationTargetRef`, bounded `EvidenceRef`, `OperationProgress`, and safe error/argument summaries;
- `ActivityEventView`, materialized `OperationView`/`CallAttemptView`, `ActivityCursor`, `ActivityHealth`, `ActivitySnapshotView`, and cursor request/response DTOs.

Internal retained events and the snapshot view use `schemaVersion: '1.0.0'`, but Renderer cannot import internal draft/policy/digest schemas from `src/shared`. The internal union has only `operation-transition`, `call-transition`, and `workflow-milestone` variants. `call-transition` requires `callId`/`callPhase` and cannot carry a reducible Operation phase; `operation-transition` carries the logical phase and no call phase; `workflow-milestone` can carry bounded progress but is not a call transition. A dedicated allowlist mapper creates `ActivityEventView` and never spreads an internal object across preload. Phase 1 producers never populate human-grant or automation authorization. `clientAcknowledged` can reflect the existing caller acknowledgement; `authorizationSource` is absent or `none`. Any future approval identifier added to activity must be a separately reviewed display id, not a continuation capability.

`src/core/activity/` owns internal event drafts, reducer state, ledger buffers, the independent non-recursive health monitor, redaction, policy, and recording handles. The ledger, not a producer, supplies `runtimeId`, sequence, event id, and default timestamp. This prevents an adapter from spoofing cursor identity.

Bounds are part of schema and redaction, not just UI rendering: target arrays, labels, codes, progress messages, summary keys, string lengths, array lengths, object depth, a per-event byte cap, and a retained-runtime byte cap all have finite limits. Unknown keys fail strict parsing. `action` is a stable machine code (the exact MCP tool name or a closed workflow action), not translated/user text. Actor labels, progress, next action, and errors use stable message codes; Phase 2 supplies en/zh copy. Target labels are only sanitized aliases/basenames. Error events expose stable `code`/`messageCode`/failure-stage, never raw messages, details, or stacks. Internal diagnostic/digest/policy fields are not members of `ActivityEventView`.

Alternative considered: reuse `ToolEvidence` and current Control Profile job DTOs. Rejected because both contain arbitrary `unknown` evidence and existing full paths/workflow shapes that are not display-safe Activity contracts.

### 2. Use two reducers over one append-only event stream

`operation-state.ts` maintains:

- one logical state record per `operationId`;
- one attempt record per `callId`, permanently bound to its first `operationId`;
- a terminal set for Operation and CallAttempt phases;
- exact legal adjacency tables plus same-phase Operation milestone updates;
- a pure runtime-end classifier.

The logical reducer consumes only `operation-transition`; the call reducer consumes only `call-transition`. `workflow-milestone` references an existing workflow Operation and can change only bounded progress/evidence references, never phase. No event can advance both reducers. The precise Operation edges are:

- `requested → awaiting-approval | blocked | queued | running | rejected`;
- `awaiting-approval → blocked | queued | running | denied | expired | superseded`;
- `blocked → queued | running | expired | superseded`;
- `queued → running | cancel-requested | succeeded | failed | cancelled | interrupted`;
- `running → cancel-requested | succeeded | failed | cancelled | interrupted`;
- `cancel-requested → succeeded | failed | cancelled | interrupted`.

The precise CallAttempt edges are `received → approval-required | rejected | started` and `started → succeeded | failed`. Terminal phases have no outgoing edge. A later call can associate with a terminal operation, but no call event carries an Operation phase and therefore cannot regress it. Duplicate event ids, a changed call association, a second call terminal, or an illegal transition returns a stable diagnostic code before storage. Sequence, never timestamp, defines reduction order.

The future approval fixture emits Operation requested, Call A received, Operation awaiting-approval, and Call A approval-required; a pending retry emits Call B received/approval-required without changing the Operation; an approved synthetic retry emits Call C received/started plus Operation queued/running/succeeded and Call C succeeded. Duplicate/concurrent synthetic continuations make at most one execution decision and cannot overwrite the terminal. Resolution without retry does not execute; a synthetically paused approval remains blocked; TTL produces expired; and a new semantic intent supersedes the old Operation. The registry production adapter does not read `approvalId`/`operationId` from raw arguments in Phase 1.

Alternative considered: one flat event that carries both `phase` and optional `callPhase`. Rejected because a delayed call-only event could carry a stale logical phase and regress the Operation reducer.

### 3. Keep the reviewed inventory and runtime policy in exact-lockstep

Create `risk-policy.ts` as a typed production projection of all 63 reviewed inventory entries. Each entry contains the runtime fields required for observation: action, normalized event surface, declared sensitivity, four-level risk, current acknowledgement predicate, future display policy, target/redaction rule, and no rationale text. A test compares this projection with `docs/security/mcp-tool-risk-inventory.json` and the static registry scanner for exact names and classifications.

Phase 0 `ToolSurface` is not reused silently as the Activity surface. The reviewed mapping is explicit: `agent-runbook → runtime`, `control-profile → control-profile`, `control-workflow → workflow`, `debug → debug`, `jlink-device-catalog → debug`, `rtt-log-session → debug`, `runtime-control → runtime`, `terminal → terminal`, `ui → ui`, and `workspace → workspace`. Tests cover every entry.

Risk maps to display policy as specified by A+D: read-only → `none`, state-affecting → `notify`, disruptive/destructive-or-unknown → `human-once`. In Phase 1 this is descriptive policy metadata only; it does not authorize or block. A succeeded high-risk current call can therefore honestly show `clientAcknowledged: true`, `authorizationSource: none`, and future `human-once` policy without claiming a human grant.

The current acknowledgement predicate is used only to classify known `CONFIRMATION_REQUIRED` outcomes before recording `started`. The seven low-level gates and `restart_mcp_runtime` use `confirm === true`; `run_control_workflow` requires it for each currently valid non-dry-run mode. The handler remains the authority for the existing business gate. If prediction and actual result drift, recording falls back to a valid failed/succeeded lifecycle, raises a policy-drift counter, and never changes the handler result.

Unknown names or sensitivity drift receive `destructive-or-unknown`, `human-once`, metadata-only redaction and a health diagnostic. Phase 0's scanner still fails CI; production observation does not silently classify unknown work as read-only.

Alternative considered: import the documentation JSON at runtime. Rejected because it sits outside the `src` build root and is explicitly review data, not a shipped runtime module. Exact-lockstep tests avoid making docs a production filesystem dependency.

### 4. Redact into a small summary instead of sanitizing a copied object

`audit-redactor.ts` never deep-clones raw input into an event. It receives the policy entry and constructs a new summary exclusively from declared rules:

- protected credentials/auth/env/nonce fields are omitted without value hashes;
- safe identifiers are length/character constrained or replaced by opaque hashes/aliases;
- paths expose at most a sanitized basename;
- script-like values expose labeled byte length, line count, and content digest;
- binary/base64/screenshot/firmware/memory payloads expose labeled size/type and, where the rule permits, a digest whose basis is explicit;
- generic unknown/nested values are omitted; only bounded category counts may remain;
- error and evidence projection uses stable codes, cursor ranges, sizes, kinds, and message codes, never raw `ToolEvidence.data`, `meta`, error text/details, or stacks.

Redaction does not enumerate arbitrary object graphs. Before enumeration, prototype lookup, descriptor lookup, or property access, it uses Node's reliable `util.types.isProxy()` check and rejects a Proxy; therefore user traps are not executed. For each declared key path on a non-Proxy it reads own data-property descriptors only; accessor properties are omitted without invoking their getters. Descriptor failures, cycles, unsupported prototypes, functions, symbols, typed arrays outside an explicit binary rule, and oversized values produce metadata-only output. Traversal uses a maximum depth, key count, array length, string length, and total summary byte budget. Secret fixtures are not included in diagnostic messages. Strict parsing/immutable cloning ensures producer mutation after append cannot alter retained output. Property/fuzz tests serialize every output and assert getter/trap counters stay zero while scanning for seeded protected values.

Alternative considered: denylist-only recursive redaction. Rejected because a new credential field or arbitrary evidence shape would be copied until somebody remembered to add a name.

### 5. Make the ledger the sole cursor and sequence authority

`ActivityHealthMonitor` is a small bounded counter sink created before the recorder/ledger. It accepts only closed stage/code enums and timestamps; it stores no event payload and never appends back into the ledger. `OperationLedger` owns one `runtimeId`, the next sequence, retained events/bytes, reducer state, materialized non-terminal views, subscriber set, and a reference to that health monitor. Default limits are 5,000 events, 1,000 tracked logical operations, 2,000 tracked CallAttempts, 16 KiB per projected event, and 16 MiB of accounted total activity state. The total budget covers immutable internal retained events, projected events/views, and fixed per-operation/per-call reducer overhead; it is deterministic accounting rather than a claim of exact JavaScript heap size. Tests inject small limits and benchmark evidence may tune these constants without changing semantics. Append performs:

1. build an immutable candidate batch with ledger-owned metadata and contiguous tentative sequences;
2. strict-validate every internal event and projected view;
3. apply each event-kind-specific reducer transition to one cloned next-state view;
4. plan the minimum prospective oldest-prefix eviction and preflight event/operation/CallAttempt/total-state capacity on the cloned next state, including active materialized views;
5. atomically commit the planned prefix eviction, whole candidate batch, reducer state, views, sequences, and byte accounting, or commit nothing;
6. notify a snapshot of current listeners in committed sequence order, catching each error independently.

Eviction is prefix-only so a cursor never crosses an unreported internal hole. It may evict early events of active work, but non-terminal Operation/CallAttempt views and reducer identities remain pinned within the explicit operation/call/total-state budgets. A terminal reducer record is released only after its last retained event leaves the prefix. If no permissible eviction can make a new begin batch fit, preflight rejects the whole batch, increments capture health once, increments `droppedEventCount` by the exact number of candidate events that never entered storage, and returns a finish-once no-op capture handle so later transitions do not cascade failures; business execution continues. Committed prefix removal increments `evictedEventCount` by the exact number of previously retained events removed and advances `oldestAvailable`; it does not increment `droppedEventCount`. An invalid/oversized batch consumes no sequence and never appears in output.

`snapshot(cursor?)` returns retained `ActivityEventView` items after the cursor, all current non-terminal Operation/CallAttempt views, the current cursor, `truncated`, `resetRequired`, optional `oldestAvailable`, `droppedEventCount`, and bounded code/count/last-occurrence health data. A terminal is guaranteed queryable exactly once only while its accepted event remains in the retained window; after eviction, truncation/oldest/eviction evidence replaces that guarantee. An empty first snapshot is runtime sequence 0 with empty events/views, no oldest cursor, false truncation/reset, and zero health/drop counters. A missing cursor returns the current retained window and reports truncation if earlier runtime history has already been evicted. A different-runtime cursor returns the current window as `truncated + resetRequired`. A same-runtime cursor exactly one below `oldestAvailable` is the no-gap recovery boundary. Negative, fractional, non-finite, unsafe, or same-runtime future cursors are invalid. `droppedEventCount` is cumulative and is never interpreted as a sequence/high-water mark.

Before sequence would exceed `Number.MAX_SAFE_INTEGER`, the ledger creates a new runtime id, clears retained state, and publishes reset semantics to subscribers. This is an exhaustion guard, not durable restart recovery.

Subscriber callbacks are synchronous fire-and-forget adapters: append never waits for a Renderer acknowledgement, and the Main subscriber only calls `webContents.send`. Exceptions, re-entrant append attempts, and unsubscribe-during-notify are isolated using a listener snapshot and append guard. This preserves deterministic order without introducing a queue service; performance tests guard against expensive payload copying.

The snapshot reads `ActivityHealth` from that independent sink: runtime-cumulative `captureFailureCount`, `droppedEventCount` for candidate events/batches that were not retained, `evictedEventCount` for committed prefix removals, `listenerFailureCount`, `policyFailureCount`, `incompleteLifecycleCount`, and bounded last safe stage/code. Drop and eviction counts are distinct and neither is a cursor/high-water mark. `incompleteLifecycleCount` is a current gauge: entering the central wrapper increments it, and the first finish-once terminal decision decrements it exactly once regardless of whether the terminal event is retained; ledger eviction never changes it. A terminal finish-once guard exists outside ledger storage. Thus a failed terminal append cannot trigger a second terminal decision and cannot recursively append a diagnostic into the same failing path. The normal fresh acceptance run requires zero capture failures, drops, evictions, and incomplete lifecycles; separate injected-small-capacity pressure tests intentionally exercise nonzero counters. Business results remain unaffected in either run.

Alternative considered: SQLite or JSONL now. Rejected because Phase 1 requires only recent reload-safe Main memory, while durable retention and crash recovery are Phase 8.

### 6. Instrument `registerTool` with an optional no-throw recording handle

Add a server-scoped recorder WeakMap and setter beside the existing runtime-diagnostics provider. `CreateMcpServerOptions` accepts the shared recorder and attaches it once; individual `ToolDefinition`/handler signatures remain unchanged.

At callback entry, the wrapper asks the provider for a recording handle using server-owned action metadata and raw arguments. The handle owns a finish-once state independent from the ledger and records Operation/Call transitions separately. Provider/redactor/append errors are caught and replaced with a health-aware no-op handle. The guard covers the entire SDK callback from entry through final `CallToolResult` construction. The lifecycle is:

1. atomically emit an ordered batch of Operation `requested`, then Call `received`;
2. version/stale-runtime rejection or runtime-diagnostics throw → atomically emit Operation/Call `rejected`; this terminal wins even if rejection response delivery later fails;
3. a policy-predicted missing current acknowledgement waits for the existing handler result; matching `CONFIRMATION_REQUIRED` → `rejected` without started/running;
4. every other admitted path atomically emits Operation `running`, then Call `started`, before awaiting the handler;
5. a handler failure/throw-normalization atomically emits Operation `failed` and finish-once Call `failed` before constructing its response; later response-delivery failure is health-only;
6. after a handler success, successful response serialization atomically emits Operation `succeeded` and finish-once Call `succeeded`;
7. payload construction or serialization failure after business success atomically emits Operation `succeeded` and finish-once Call `failed` with safe delivery stage, then rethrows exactly as before;
8. capture failure increments health but cannot change any of the preceding business decisions.

The recording handle's finish-once guard, not a lookup for a retained terminal event, prevents double terminalization. It only receives redacted result classification, not the response object. Phase 1 does not insert ids into `evidence.meta`; this keeps all existing result shapes unchanged.

SDK validation occurs before this callback. Invalid SDK input therefore creates no ordinary operation/call; the existing JSON-RPC validation error is the distinct diagnostic evidence and tests assert the normal activity ledger stays unchanged. A transport validation ledger can be added later only through a separate event type, never by fabricating handler entry.

Alternative considered: wrap or edit all 63 handlers. Rejected because the central wrapper already supplies the exact post-schema boundary and is safer to characterize once.

### 7. Add a best-effort post-commit observer to JobManager

Extend `ControlWorkflowJobManagerOptions` with an optional observer receiving a transition kind and a new detached immutable `ControlWorkflowJobObservation` after a state commit. This dedicated envelope has primitive leaves only and is constructed from fresh safe values: job id, state, mode, trusted internal actor origin, timestamps, cancel flag, current step id, and bounded copied step `{id,status,durationMs,errorCode?,failureCode?}` summaries inside a detached frozen array. It contains no root, input, workflow/evidence object, error text/details, next action, blocking detail, controller, or alias to the retained record. Existing `ControlWorkflowJobSnapshot` and the deliberately shallow-cloned nested `step.evidence` compatibility behavior remain untouched. Observer mutation therefore cannot mutate retained workflow state.

`CreateControlWorkflowJobInput` gains optional Main/internal activity metadata defaulting to `system`; the MCP registration supplies `agent`, while only the existing `CONTROL_PROFILE_START_DOWNLOAD` Main handler supplies `human`. Renderer payload cannot set this metadata. The MCP child job is fixed to surface `workflow`, action `control-workflow.job`, risk `destructive-or-unknown`, and descriptive policy `human-once`; the direct Main download job is fixed to surface `control-profile`, action `control-profile.download-job`, the same risk/policy, and an opaque job-id target with at most a redacted workspace alias. Both keep `authorizationSource: none`. Notify after create, mark-running, update, cancel-requested, and terminal commits through one private funnel. A private notifier catches observer exceptions; observer state is never read to select manager behavior.

The recorder uses Node `AsyncLocalStorage` only as a trusted correlation context around a registry handler. If an MCP handler creates a background job, the observer captures the current server-owned launch `operationId` once; subsequent async updates use the stored mapping. The launch call/Operation ends when the handler returns the existing job reference, while a separately generated job Operation carries that `parentOperationId`. Direct Main START_DOWNLOAD has no fabricated parent. Later job milestones contain no `callId`.

The recorder maps one server-generated job operation per manager job and uses the existing server-generated `jobId` only as a display-safe target/correlation. It emits queued/running/progress/cancel-requested/succeeded/failed/cancelled phases. It records a progress milestone only when state, current step, bounded numeric progress, or a safe message code changes; identical/high-frequency updates coalesce. It reads only approved mode/state/timestamps/current step and reduces workflow steps to stable step ids/message codes/numeric progress/cursor refs. It never places `RunControlWorkflowInput`, root, full workflow, arbitrary evidence, next-action text, error details, or AbortController in the event.

Both MCP background workflow and direct Control Profile START_DOWNLOAD use the same manager instance, so this seam observes both without changing execution or approval semantics. Phase 1 adds no direct RUN_DOWNLOAD or other human IPC recorder. It never infers actor identity from `correlationId`.

Alternative considered: poll `listJobs()` from Renderer. Rejected because polling misses short transitions, exposes an unsafe large DTO, and couples observation to panel visibility.

### 8. Compose once in Main and expose an atomic subscribe-plus-snapshot bridge

`registerIpcHandlers` creates the health monitor, ledger, and recorder before the JobManager, passes the same recorder to direct `createMcpServer` and `startMcpHttpRuntimeServer`, registers `activity-ipc`, and exposes the ledger in `MainProcessContext` for later Main composition/testing. `http-runtime-server` already spreads its options into each per-request server, so the shared recorder reference propagates without per-request storage.

`registerActivityIpc` owns a `webContents.id` subscriber map. Its handler synchronously performs `validateCursor → register/refresh sender → snapshotFromValidatedCursor` with no `await`; invalid cursors therefore cannot mutate subscription state, while successful registration still precedes the snapshot cut. It installs one destroyed hook on first subscription. `activity:unsubscribe` idempotently removes the sender; destroyed cleanup is the fallback. `activity:snapshot` validates and reads without registering. The ledger subscription forwards each safe view through `activity:event`, checking destruction and catching the destroy/send race. Teardown removes all handlers/listeners, unregisters the ledger callback, and clears references.

`window.linkterm.activity` exposes only:

- `subscribe({ cursor? }) -> Promise<PreloadResult<ActivitySnapshotView>>`;
- `unsubscribe() -> Promise<PreloadResult<{ unsubscribed: true }>>`;
- `snapshot({ cursor? }) -> Promise<PreloadResult<ActivitySnapshotView>>`;
- `onEvent(handler) -> Unsubscribe`.

Preload uses activity-specific parsers for both invoke responses and pushed events before calling Renderer; it does not rely on the existing generic TypeScript cast and exposes no `ipcRenderer`. Phase 2 must attach `onEvent` before calling `subscribe`, buffer concurrent events, replace from the returned snapshot cut C, discard buffered events at/below C, apply only newer events in sequence, and read-since/resnapshot on a gap. Phase 1 tests this protocol and multiple-window cleanup without building a Renderer store or Activity Center.

Alternative considered: broadcast to every BrowserWindow with event-only `ui-bridge`. Rejected because reload would lose history and snapshot/event races would have no subscriber registration boundary.

### 9. Keep runtime-end recovery honest

Renderer reload and MCP reconnect retain Main memory and hydrate by cursor. A clean Main shutdown can apply the pure runtime-end classifier before disposal for tests/diagnostics. A crash cannot persist or recover Phase 1 memory, and the next process starts a new runtime id with an empty ledger. Phase 1 snapshot materializes only current in-process non-terminal state; it is not restart recovery. Phase 8 will add JSONL/startup recovery; Phase 1 UI/API must not claim otherwise.

## Risks / Trade-offs

- **HIGH-risk registry and JobManager edits can affect many callers** → Run fresh GitNexus upstream impact on every modified existing symbol, report HIGH/CRITICAL results before editing, preserve Phase 0 characterization, and keep instrumentation optional/no-throw.
- **Policy prediction could drift from confirmation handlers** → Exact 63-tool/inventory tests plus parameterized acknowledgement behavior tests; drift records a diagnostic and never changes the business gate.
- **Logs can become a secret repository** → Construct allowlisted summaries from scratch, strict schemas/bounds, seeded property/fuzz tests, and directed PDG/taint review of registry/redactor paths.
- **HTTP per-request servers can fragment identity** → Main owns one recorder/ledger and injects the same reference into every server instance; multi-request tests assert a shared runtime cursor.
- **Snapshot/event race can lose or duplicate events** → Main registers before snapshot; preload listener is attached first; consumer deduplicates by runtime/sequence.
- **Best-effort observation can drop evidence** → Visible bounded health/drop counters, a normal acceptance-run release criterion with capture-failure, dropped-event, eviction, and incomplete-lifecycle counts all exactly zero, and no authorization dependence on the ledger.
- **Terminal append failure could tempt a second finish path** → Finish-once guard is independent of retained ledger state; the health sink is non-recursive and acceptance separates decision, attempted emission, and retained evidence.
- **5,000-event/1,000-operation caps may be too small or expensive** → Injectable limits and focused benchmarks; adjust only with evidence without changing cursor semantics.
- **Job snapshots contain unsafe existing DTOs** → Recorder-specific projection; never reuse Control Profile preload DTOs or spread manager snapshots into activity.
- **Phase 1 state fixtures can be mistaken for approval implementation** → Production registry never consumes an approval id, and OpenSpec/tests label fixture-only transitions explicitly.

## Migration Plan

1. Add shared schemas, reducers, redactor, risk policy, ledger, recorder, and tests without wiring production.
2. Add the optional JobManager observer and prove all existing job behavior remains identical with throwing/no-op observers.
3. Add the optional registry provider and prove every characterized result/throw branch is unchanged with recording enabled and disabled.
4. Create one Main-owned ledger/recorder, pass it through direct and HTTP server construction, and register the IPC bridge.
5. Add/update only the typed preload contract and test fixture needed for the new namespace; do not create Renderer UI state.
6. Run focused tests after every slice, then full lint/build/test/license/coverage/audit, independent review, verification, GitNexus detect-changes, and directed PDG/taint checks.

Rollback is additive: remove Main injection/IPC registration first, then optional recorder/observer wiring, then the new modules. Existing handlers and JobManager defaults continue operating without a recorder. No data migration or persistent file rollback is needed because Phase 1 writes no activity files.

## Open Questions

No unresolved product decision blocks Phase 1. Capacity defaults are accepted as implementation starting values and can be tuned only from Phase 1 benchmark evidence without changing the specified identity, safety, or cursor contracts.
