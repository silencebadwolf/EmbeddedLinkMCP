## Why

Phases 0–7 make LinkTerm operations observable, reviewable, approval-bound, and pausable,
but the current activity projection is runtime-only. A restart loses the evidence needed to
explain what happened, and users have no local, privacy-safe export or deletion boundary.
Phase 8 adds a bounded durable copy of the already-redacted activity events without moving
authority, secrets, terminal content, or hardware state into persistence.

## What Changes

- Add a Main-owned `AuditStore` that appends display-safe activity events to JSONL under
  Electron `userData/activity/` through an independent serial queue.
- Enable persistence by default with a 30-day retention window and 10 MiB per-file rotation;
  support an explicit disabled mode for privacy-conscious users.
- Recover the newest bounded records at startup, ignore only a damaged trailing JSONL line,
  and expose a safe health warning rather than inventing a terminal operation state.
- Add Main-mediated activity export and delete-all-local-data commands. Export writes the
  selected redacted representation from Main and returns only a display-safe summary.
- Add bounded audit status and export/clear controls to the existing Activity Center, with
  English/Chinese, keyboard, screen-reader, reduced-motion-safe copy.
- Add redaction/property/fuzz fixtures, crash/rotation/retention tests, and a 10k-event
  append/reload performance baseline.

## Scope Boundaries

This change does not add a database, cloud sync, telemetry, remote approval, generic chat,
new hardware side effects, rollback/undo promises, or raw transcript persistence. Prepared
operations, grants, authorization records, caller principals, leases, compensation internals,
credentials, scripts, binary/firmware bytes, screenshots, absolute paths, and raw terminal
data remain outside the durable store and preload.

## Impact

Expected implementation areas:

- `src/core/activity/audit-store.ts` and `src/shared/audit-contract.ts`.
- Existing activity IPC/preload contracts and Main context wiring.
- Existing Activity Center drawer and i18n tables.
- Unit/integration tests plus a documented performance fixture.

No new runtime dependency is expected.
