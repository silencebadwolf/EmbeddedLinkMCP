# Design: Phase 8 Durable Audit

## Goals

- Persist only the `ActivityEventView` projection, which has already passed the allowlist-first
  `AuditRedactor` and schema validation.
- Keep append latency off MCP handlers, transport writes, and renderer event delivery.
- Make restart recovery deterministic and bounded: recent valid records are available, a torn
  final line is diagnosed, and no record is promoted to a new operation terminal state.
- Keep file access and export authority in Main; Renderer receives DTOs and summaries only.

## Data flow

```text
OperationLedger.appendBatch
        └─ synchronous display-safe listener
             └─ AuditStore.enqueue(ActivityEventView)
                  └─ serial promise queue → activity/activity.jsonl
```

The ledger remains the source of the live Activity Center projection. AuditStore failures are
reported through the activity health diagnostic seam and never reject or alter the original
ledger append.

## File format and lifecycle

- Directory: `<userData>/activity/`.
- Active file: `activity.jsonl`; rotations use `activity.<UTC timestamp>.<counter>.jsonl`.
- Each line is a strict envelope `{ schemaVersion, recordType: 'activity-event', event }`.
- The event is parsed with `ActivityEventViewSchema` before enqueue and again before export.
- On append, rotation happens before a write that would exceed 10 MiB, except a single event
  larger than the limit is written to its own file so it is never silently dropped.
- Retention removes files whose newest filesystem timestamp is older than 30 days. Retention
  runs at startup and after rotation; disabled mode stops new writes and leaves no new files.
- POSIX files are chmod 0600. Windows uses the userData directory ACL and status exposes only
  `windowsAclDefault: true`, never an absolute path.
- Startup reads newest files up to a bounded byte/event budget. Invalid complete lines are
  skipped with a warning count; an invalid final line is classified as `trailing-line-recovered`.

## Queue and failure semantics

`enqueue` is fire-and-forget and returns immediately. `flush()` is used by tests and shutdown.
The queue remains usable after a write failure; the failed event is counted as a diagnostic and
is not retried indefinitely. `clear()` is serialized behind prior writes, removes only files in
the configured activity directory, recreates the directory, and resets status.

## Export

`export()` runs in Main and reads only validated, retained envelopes. It supports `jsonl` and
pretty `json` output plus a `pathMode` label (`basename` by default). Because raw paths are
never retained, `full` can only preserve the already-redacted representation; it cannot recover
or synthesize an absolute path. The result returns `fileName`, `format`, `eventCount`,
`redacted: true`, and `pathMode`, not the absolute destination.

The IPC export command accepts format/pathMode only. Main chooses a timestamped file under an
export subdirectory; a future native save dialog can replace that destination without widening
the Renderer contract.

## IPC contract

Add `activity:export`, `activity:clear`, and `activity:status`. Existing snapshot/subscribe
semantics remain unchanged. Every result is parsed with shared Zod schemas. Renderer can request
export or deletion but cannot read the activity directory, pass a path, or receive internal
authority values.

## Productization

The Activity Center displays an audit status summary, `Export redacted activity`, and
`Delete all local activity data` with confirmation. Controls are semantic buttons, keyboard
reachable, and use visible text plus `aria-label`; no status depends on color or motion.

## Non-goals and invariants

- No raw `ActivityEventDraft`, `RetainedActivityEvent` accounting fields, credentials, full
  scripts, binary bytes, terminal transcript, screenshot, firmware, or internal approval data
  cross the store boundary.
- No real flash, erase, reset, probe attach, GDB/RTT launch, or serial payload is introduced.
- No durable operation is inferred from a recovered event; recovery is evidence only.
