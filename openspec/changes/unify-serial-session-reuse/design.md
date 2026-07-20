## Context

All human and AI terminal operations already share one `SessionManager`, but serial creation is
distributed. MCP `open_session`, renderer `session:create`, saved connections, full-workspace
observation, `activate_control_profile`, and control workflows can each call `buildSession` and
open a transport. The only reuse helper lives inside the control-workflow runner and compares only
port, baud rate, and mode after a session is already open. That leaves races, incomplete identity,
and duplicate errored tabs.

The coordinator must remain Main-owned and must not cross preload. Existing `SessionManager`,
`WriteQueue`, transcript, and transport ownership remain the terminal authority.

## Goals / Non-Goals

**Goals:**

- Give every serial entry one create-or-reuse boundary.
- Define complete normalized serial identity and a stable conflict result.
- Prevent duplicate transport opens and duplicate errored tabs under concurrency.
- Keep existing UI behavior for a genuinely new human open that fails at the transport.

**Non-Goals:**

- Reusing SSH, local-shell, or RTT sessions beyond RTT's existing coordinator.
- Changing serial framing, terminal echo, `send_and_wait`, write ordering, focus, or AI/human access.
- Adding approvals, pause/take-over, cloud state, telemetry, or hardware rollback.
- Executing real hardware opens or other hardware side effects during automated verification.

## Decisions

### Use an explicit Main-owned `SerialSessionCoordinator`

`registerIpcHandlers` creates one coordinator beside `SessionManager` and injects it into renderer
IPC and both direct/HTTP MCP server paths. MCP server construction accepts an optional injected
coordinator for tests and standalone callers but uses one instance consistently inside a server.

This keeps serial policy out of transport-agnostic `SessionManager` while making the shared runtime
ownership visible in dependency wiring. A prompt-only `list_sessions` convention was rejected
because it cannot close races or protect noncompliant clients.

### Normalize identity before examining active state

The identity contains normalized port, baud rate, mode, data bits, stop bits, parity, RTS/CTS, XON,
and XOFF. Optional values resolve to the same defaults used by serial transport construction. COM
names compare case-insensitively; non-COM device paths keep platform-significant case.

The coordinator first examines an in-flight request for the physical port, then active
`idle`/`opening`/`open` summaries. Exact identity joins/reuses. Any different identity for the same
port fails with `SERIAL_SESSION_CONFLICT`. `closed` and `errored` summaries are ignored.

### Single-flight by physical port

An in-memory map stores the current open promise and normalized identity for each physical port.
Equivalent overlapping calls await one promise; the owner reports `reused=false` and joiners report
`reused=true`. A conflicting overlap fails before any second session or transport is created. Map
entries are removed in `finally`, including open failure.

The map is per coordinator, so different ports do not block each other.

### Preserve entry-specific genuine-open failure semantics

The coordinator owns selection and single-flight but accepts a failure-retention policy. Renderer
opens keep the existing visible errored tab when no active owner existed and the genuine transport
open itself fails. MCP opens remain fail-and-remove. A coordinator-detected conflict never creates
an errored tab under either policy.

### Return reuse metadata without widening shared renderer contracts

The coordinator result contains `reused`, and MCP evidence exposes it where useful. Existing IPC
callers continue to receive the authoritative `sessionId`; when it matches an existing renderer
entry, the current Zustand `Map` upsert selects that tab rather than creating another one. Complete
identity remains Main-only inside the coordinator, avoiding a high-blast-radius expansion of
`SessionMetadata`, `SessionSummary`, and renderer `SessionMeta`. Existing persisted saved-connection
and control-profile formats remain unchanged.

### Retire the workflow-local reuse helper

Control-profile activation and control workflows receive an open function backed by the shared
coordinator. The workflow-local `findReusableSerialSession` is removed so it cannot diverge from
the cross-entry policy.

## Risks / Trade-offs

- [A serial device legitimately supports two opens] → LinkTerm intentionally treats one physical
  port as exclusive because the current serial transport and user model assume one owner.
- [Metadata from older/legacy sessions omits optional fields] → Normalize missing fields to current
  transport defaults before comparison.
- [A caller changes only the label] → Labels are display metadata, not serial identity; the first
  active session label remains authoritative until that session closes.
- [The first of two concurrent callers chooses failure-retention policy] → Both callers observe the
  same physical attempt; no second attempt is made until it settles.

## Migration Plan

No persisted data migration is required. Saved connections and control-profile files keep their
existing schemas. Deployment is a runtime behavior change; rollback removes coordinator injection
and the added response fields without rewriting user data.

## Open Questions

None. The user has explicitly selected reuse of the existing shared terminal over creating a new
connection when a compatible saved workspace already exists.
