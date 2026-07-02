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
- Run targeted IPC/RTT/hydration tests plus OpenSpec validation.

## Non-Goals

- Do not change flash/download workflows.
- Do not infer firmware logging behavior from RTT channel silence.
- Do not auto-start additional debug backends beyond existing RTT log session behavior.
