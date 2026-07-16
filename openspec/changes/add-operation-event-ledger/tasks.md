## 1. Contract and risk gates

- [x] 1.1 Record fresh GitNexus upstream-impact results for every existing function, class, method, interface, and shared object selected for modification; report HIGH/CRITICAL blast radius before editing.
- [x] 1.2 Add failing contract tests for the strict internal retained-event union under `src/core/activity/`, the separate display-safe event/snapshot schemas under `src/shared/`, materialized active views, cursor validation, byte/shape limits, and internal-field rejection.
- [x] 1.3 Implement the versioned internal and display contracts plus explicit allowlist internal-to-view mappers until the contract tests pass without object-spreading internal events or exposing arbitrary `unknown` fields.

## 2. Policy and write-before-ledger redaction

- [x] 2.1 Add failing completeness tests that compare all 63 runtime policy entries with the Phase 0 inventory, registry definitions, reviewed ToolSurface-to-Activity-surface mapping, sensitivity, risk, and acknowledgement rules.
- [x] 2.2 Implement the typed observation/risk/redaction policy, including conservative unknown/mismatch behavior, without enforcing new authorization.
- [x] 2.3 Add failing table/property/fuzz tests for credentials, tokens, paths, scripts, base64/binary/firmware/screenshot/memory payloads, raw evidence/errors, cycles, oversize input, and post-append mutation; assert accessor getter and Node-detectable Proxy trap invocation counts remain exactly zero.
- [x] 2.4 Implement the allowlist-first bounded redactor and immutable summary projection until protected fixtures never appear in serialized output.

## 3. State machines, health, and ledger

- [x] 3.1 Add failing tests for the closed Operation and CallAttempt adjacency tables, terminal immutability, finish-once decisions, invalid/duplicate/out-of-order transitions, confirm-false-to-true identity, and synthetic first/pending/approved/concurrent/paused/no-retry/TTL/supersede approval-retry fixtures.
- [x] 3.2 Implement isolated Operation/CallAttempt reducers and the pure runtime-end classifier without enabling a production approval continuation.
- [x] 3.3 Add failing tests for non-recursive capture/listener/policy health counters and the finish-once `incompleteLifecycleCount` gauge; distinct never-retained `droppedEventCount` and committed-prefix `evictedEventCount`; default 5,000-event, 1,000-Operation, 2,000-CallAttempt, 16 KiB projected-event, and 16 MiB accounted-total-state limits; active-view pinning; atomic lifecycle batches and capacity preflight; prefix eviction; runtime mismatch/reset; oldest-boundary recovery; future/invalid cursor rejection; sequence exhaustion; listener faults; re-entrancy; and unsubscribe.
- [x] 3.4 Implement `ActivityHealthMonitor` and `OperationLedger` with atomic batch commit-or-no-op behavior until cursor/truncation/materialized-view, total-state accounting, and best-effort failure tests pass.

## 4. Recorder and workflow-job lifecycle

- [x] 4.1 Add failing recorder tests for server-generated ids, separate transitions, safe targets/summaries, independent finish-once behavior, terminal capture failure, response-delivery failure, and trusted async parent context.
- [x] 4.2 Implement `OperationRecorder`, no-op/fault-isolation handles, explicit view projection, and AsyncLocalStorage correlation for a child workflow operation.
- [x] 4.3 Add failing JobManager tests for post-commit create/running/update/cancel-requested/terminal notifications, a detached immutable observation envelope with primitive leaves, trusted agent/human/system metadata, progress coalescing, observer throws/mutation/re-entrancy, and unchanged snapshots/cancellation/retention—including the characterized nested evidence alias.
- [x] 4.4 After fresh impact reporting, add the optional JobManager observer funnel and narrowly scoped trusted actor metadata at both existing creation call sites: `src/mcp/surfaces/control-workflow/tools.ts` for MCP background jobs and `src/main/ipc/control-profile-ipc.ts` for Main `CONTROL_PROFILE_START_DOWNLOAD`; Renderer input cannot supply that metadata.

## 5. Central registry instrumentation

- [x] 5.1 Extend the Phase 0 registry characterization with failing assertions for recorded success, handler failure, `ToolError`, unexpected throw, version rejection, stale rejection, runtime-diagnostics throw, known acknowledgement rejection, payload/serialization failure, SDK pre-handler rejection, provider/redactor/append failure, and unchanged results/backend counts; prove an already-decided rejection remains the CallAttempt terminal when its response later fails serialization.
- [x] 5.2 After the fresh HIGH-risk `registerTool` warning, add the server-scoped recorder-provider seam and instrument the full SDK callback boundary without changing any of the 63 handler signatures or returning ids in tool results.
- [x] 5.3 Add integration tests proving direct and per-request HTTP MCP servers use one Main-owned runtime ledger/cursor and never trust client operation/call identity.

## 6. Main composition and activity IPC/preload

- [x] 6.1 Add failing Main IPC tests for synchronous validate-cursor-before-register and register-before-snapshot ordering, read-only snapshot, cursor/reset errors, live-before/after-snapshot cut, independent multi-window subscribers, repeat subscribe, explicit idempotent Main unsubscribe, destroyed/send-race cleanup, malformed payload, and safe DTO-only output.
- [x] 6.2 After fresh impacts, create one Main-owned health/ledger/recorder, propagate it through direct and HTTP server construction, register/teardown `activity-ipc`, and expose only the ledger in `MainProcessContext`.
- [x] 6.3 Add failing preload tests for the narrow activity namespace, runtime parsing of invoke responses and pushed events, listener removal, and malformed-payload rejection without exposing `ipcRenderer`.
- [x] 6.4 Add `activity:subscribe/snapshot/unsubscribe/event` channels, type-only `PreloadAPI` declarations, activity-specific runtime parsers, preload methods with explicit Main unsubscribe, and the renderer test mock surface without creating an Activity Center store or component.

## 7. Review and verification

- [x] 7.1 Run focused unit/integration tests after each vertical slice and confirm all Phase 0 characterization and 63-tool inventory guards remain green.
- [x] 7.2 Run lint, production build, full tests, coverage report, runtime/tooling license validation, and production dependency audit with fresh output on the accepted Node/pnpm matrix.
- [x] 7.3 Request independent requirements and code-quality/security reviews; resolve every valid finding and rerun affected checks.
- [x] 7.4 Run verification-before-completion, OpenSpec strict validation, `git diff --check`, directed GitNexus PDG/taint checks for registry/redaction paths, and `detect_changes` against `main`; verify only intended symbols/processes changed.
- [x] 7.5 Document the orphaned `src/mcp/stdio-entry.ts` as a legacy unsupported/non-default entry, without advertising it as covered by the Main-owned ledger.
- [x] 7.6 Record Phase 1 evidence, known limits (in-memory only, no production approval/UI/Pause/persistence), and a normal acceptance run in which capture-failure, dropped-event, eviction, and incomplete-lifecycle counters are all exactly zero; report small-capacity pressure evidence separately and explicitly request authorization before Phase 2.
