# Design: J-Link Hardware Truth

## Problem

The existing `ProbeHandle` is a software capability handle, not evidence of a live target. The
adapter currently creates the handle before any Commander operation and projects every retained
handle as `connected: true`. Renderer progress similarly projects workflow state into percentages
even when the backend supplied no percentage.

## Connection evidence boundary

`JLinkCommanderClient` gains a target-access operation implemented by
`DefaultJLinkCommanderClient`. It runs the normal LinkTerm-controlled connection preamble with
`-ExitOnError 1` and accepts success only when both conditions hold:

1. process exit/output contains no recognized connection failure; and
2. sanitized Commander output contains positive target-access evidence such as a discovered SW-DP,
   an identified CPU/core, or an explicit established target connection.

The operation is read-only: it does not flash, erase, reset, halt, or start GDB/RTT. A custom
Commander client that does not implement target access fails closed with `NOT_IMPLEMENTED`.

`JLinkAdapter.probeConnect()` performs this operation before it creates or reuses a handle.
`probeStatus()` revalidates before returning connected state and retires a stale idle handle after
failure. `probeDetect()` reports Commander-observed physical probes only; an in-memory handle is
never sufficient physical evidence.

## Progress evidence boundary

Three progress classes are kept separate:

- stage-only: preparing, erasing, verifying, and readback text without a percentage;
- measured: a percentage parsed directly from streamed Commander output;
- terminal: 100% only after the complete operation and required verification return successfully.

The renderer does not synthesize 8%, 18%, 95%, or failed 100% values. Missing numeric evidence
renders a stage label with an empty progress fill. `bytesWritten` is not inferred from a percentage.

## Completion wording

Verified workflows may say “Download verified”. Successful workflows without verification say
“Download command completed · not verified”; they must not imply content equality.

## Test strategy

- Pure adapter tests use injected Commander clients and prove failure is propagated before handle
  creation.
- Commander tests use captured process output and prove positive evidence is mandatory.
- Workflow and IPC tests prove no `probeConnected=true` or UI connected phase is produced from a
  failed target-access check.
- Renderer tests prove numeric width only follows backend percentage or verified terminal success.
- No test invokes real hardware executables.
