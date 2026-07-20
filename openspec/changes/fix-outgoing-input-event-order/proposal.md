# Fix outgoing input event order

## Why

Some serial devices echo bytes synchronously from `transport.write()`. LinkTerm
currently appends the AI/human transcript event only after that promise resolves,
so the device echo can reach the renderer first. The terminal then appears to
show only device output or shows the command glued into the preceding log line.

## What changes

- Add a write-queue start callback that runs immediately before `writer`.
- Register the outgoing human/AI data event at that boundary.
- Keep write-result auditing for failures; a failed write emits a visible system
  error after the attempted outgoing event.
- Apply the same ordering contract to serial, SSH, local-shell, and RTT sessions
  without adding origin labels or changing shared terminal ownership.

## Scope

In scope: `WriteQueue`, `SessionBase`, `RttLogSession`, renderer-facing transcript
ordering tests, and this OpenSpec change.

Out of scope: transport protocols, terminal rendering heuristics, AI retry policy,
approval/pause/takeover UI, and hardware operations.

## Acceptance criteria

1. When a transport emits a synchronous echo during `write()`, the transcript
   sequence is outgoing human/AI data first, then device data.
2. The renderer therefore displays the command before the device response while
   retaining existing echo de-duplication.
3. A writer rejection leaves the attempted outgoing event visible and appends a
   non-fatal system writer error; subsequent queue items still run.
4. Human and AI continue to share the same WriteQueue and terminal session with
   no approval, pause, takeover, or visible origin label changes.
