# Design: settle-read send_and_wait

## Flow

```text
write AI bytes
  -> register waitFor with a false predicate
  -> for settleMs, collect filtered device-origin transcript bytes
  -> read cursor and return the collected observation
```

`SessionManager.waitFor` remains the observation/timing seam. The predicate
never resolves on a marker; it feeds the existing echo handler and completion
detector, then returns `false`. The timeout outcome is therefore the normal
settle boundary, not a command failure. A closed session still resolves early
with the existing closed outcome.

## Result contract

Successful settle results use `reason: 'settled'`, include `received` and
`receivedBase64`, and expose `hasDeviceOutput`, `receivedTruncated`,
`receivedTotalBytes`, plus `matchedMarkerIndex` (or `null`). The MCP handler
returns these fields as terminal evidence instead of
throwing `TIMEOUT` for an absent marker or absent output.

The observation buffer is capped independently at 1 MiB. The completion
detector keeps its smaller rolling marker window, but detector eviction cannot
truncate the bytes returned to the AI without an explicit truncation flag.

`markAiUnresponsive` is deliberately not called by this path. A caller that
wants a stronger health policy can inspect `hasDeviceOutput`, call
`read_from_session`, or use `get_session_status` before deciding what to do.

## Compatibility

`TerminalRuleSet.defaultSettleMs` and `SendAndWaitArgs.settleMs` are the new
names. `timeoutMs` remains accepted in both the core args and MCP schema as a
deprecated alias, with `settleMs` taking precedence when both are present.
Completion marker input remains accepted for result annotation and migration,
but its matching semantics are non-blocking.
