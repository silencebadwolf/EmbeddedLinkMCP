## Problem Boundary

The App and MCP server intentionally share one `SessionManager`. That shared object is the architectural boundary that keeps human and AI terminal activity synchronized. A session created by MCP is not complete unless it can be discovered by:

1. `session:list` hydration snapshots,
2. `SESSION_LIFECYCLE` create/state/destroy events, and
3. normal transcript subscription/read APIs.

RTT log sessions already satisfy the storage and transcript parts. The weaker boundary is lifecycle propagation. `SessionManager` emits both:

- `session:event` for transcript events, including state transcript events from implementations that append them, and
- `session:state` for direct state transitions.

`registerSessionIpc` currently broadcasts `stateChanged` only when it observes a transcript event whose type is `state`. That couples UI state synchronization to a transcript implementation detail. The UI should instead be coupled to the manager's explicit state lifecycle event.

## Approach

- Add an IPC listener for `SessionManager`'s `session:state` event.
- Resolve the current summary with `sessionManager.summaryOf(sessionId)` and broadcast `{ type: 'stateChanged', session }`.
- Remove the transcript-event special case or make it non-duplicating, so a state transition does not send two identical lifecycle updates when both manager state and transcript state are emitted.
- Keep transcript event forwarding unchanged for subscribed terminals.

## Tests

- Add a main IPC regression test using a test session that emits a state transition without a transcript `state` event. The test must fail before the fix and pass after `session:state` forwarding is added.
- Keep RTT log session tests proving `open_rtt_log_session` registers RTT metadata in normal session summaries.
- Add RTT log session coverage proving a connected but initially silent RTT channel records system-origin guidance before device bytes arrive.
- Run targeted IPC/RTT/hydration tests plus OpenSpec validation.

## Non-Goals

- Do not change flash/download workflows.
- Do not infer firmware logging behavior from RTT channel silence; only surface clear next diagnostic action.
- Do not auto-start destructive or CPU-mutating debug operations from RTT observation. Starting the managed GDB server is allowed only as part of profile/root-based RTT observation because the backend requires it for RTT transport ownership.

## Profile-Based RTT Observation

The previous `open_rtt_log_session` MCP surface only accepted a `probeId`, and the App IPC root/profile path only performed `probeConnect -> rttConnect`. On real J-Link backends, RTT attach requires LinkTerm's managed GDB server with RTT telnet support to be running. That forced agents to call the low-level `gdb_server_start` tool before opening an App-visible RTT log session, which broke the product contract: automatic observation should be expressed as one high-level intent, not as manually chained internal backend steps.

The fix is to make profile/root-based RTT observation the high-level entry point:

- App IPC root/profile open resolves the control profile, connects the probe, starts the managed GDB server, connects RTT, then opens/reuses the shared RTT log session.
- MCP `open_rtt_log_session` accepts either an existing `probeId` or a workspace `root`. The `probeId` path remains the low-level reuse path and assumes RTT is already connected. The `root` path resolves the control profile, connects the probe, starts the managed GDB server, connects RTT, and creates the App-visible RTT log session.
- Low-level `gdb_server_start` remains confirmation-gated. High-level profile/root RTT observation owns the internal GDB startup and returns structured evidence that the GDB server and RTT channel were prepared as part of the same request.
- Agents should prefer the `root` path for continuous RTT logs. They should not manually call `gdb_server_start` solely to satisfy RTT log setup.

The real SEGGER GDB server may report its GDB port as ready before the RTT telnet endpoint accepts connections. `JLinkAdapter.rttConnect` therefore waits with a bounded retry loop for the RTT telnet endpoint when the failure is the known transient endpoint-not-ready error. This keeps the high-level observation request reliable without retrying destructive operations or hiding unrelated J-Link failures.
