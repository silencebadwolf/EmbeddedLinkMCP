# Settle-read send_and_wait

## Why

`send_and_wait` currently treats a completion marker as the command's completion
condition. Embedded targets do not share one prompt/marker convention, and a
healthy device can emit output without matching the caller's marker. That path
is currently reported as a timeout and can latch `DEVICE_UNRESPONSIVE`, causing
later AI writes to fail even though the transcript is still receiving output.

## What changes

- Send the payload through the existing `SessionManager`/`WriteQueue` boundary.
- Wait a bounded, configurable settle interval (`settleMs`), then return the
  device-origin bytes observed during that interval.
- Completion markers become optional result metadata only; they never block the
  return path.
- A settle with no device bytes is returned as an observation result with an
   explicit `hasDeviceOutput=false`; it does not automatically latch
   `DEVICE_UNRESPONSIVE` or make the AI retry.
- Observation output uses an independent bounded buffer and reports
  `receivedTruncated`/`receivedTotalBytes`; marker detector limits never change
  the returned output size.
- Keep `timeoutMs` as a deprecated compatibility alias for `settleMs` so older
  MCP clients remain valid during migration.

## Scope

In scope: terminal core result types/rules, MCP schema/handler descriptions,
regression tests, runbook wording, and this OpenSpec change.

Out of scope: transport protocols, SessionManager queue ordering, human input,
hardware operations, automatic retries, or removal of the legacy manual
`markAiUnresponsive` API used by older callers/tests.

## Acceptance criteria

1. A device response without a matching marker returns after `settleMs` with
   `success=true`, the filtered response bytes, and `hasDeviceOutput=true`.
2. No response returns after `settleMs` with `success=true`, empty bytes, and
   `hasDeviceOutput=false`; no unresponsive latch is created.
3. A marker, when supplied, is reported as metadata (`matchedMarkerIndex`) but
   is never required for success.
4. Session close, queue-full, write errors, and abort retain their existing
   error semantics.
5. Existing callers using `timeoutMs` still compile and interpret it as the
   settle interval.
