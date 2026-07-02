## Why

Control profiles can explicitly select RTT as the observation channel, but the high-level flash workflow previously treated flash-observe as serial-first. A partial fix stopped opening serial when `rtt.enabled=true`, but it still produced no RTT observation step, leaving agents to infer status from incomplete evidence and drift into manual probe/flash retries.

RTT profiles must remain RTT profiles throughout the workflow: no implicit serial open, no empty observation summary, and no hidden requirement for the agent to chain low-level tools after a high-level workflow.

## What Changes

- When `run_control_workflow` runs flash-observe or flash-observe-diagnose with `rtt.enabled=true`, it uses RTT observation by default.
- The workflow starts the managed GDB server needed by the J-Link RTT backend, connects RTT, clears the selected up-channel before reset, and reads RTT after reset until markers or timeout.
- Workflow evidence includes explicit `needsRtt`, `connect_rtt`, `observe_rtt`, and `summary.rttObserved` fields.
- Explicit `observe.serial=true` still opts into serial observation.
- Download-only callers can pass `observe.enabled=false` to flash/verify/reset without starting serial or RTT observation.
- Workflow-managed GDB servers are stopped before final evidence is returned, including RTT connection failure paths.

## Impact

- Affected code areas:
  - `src/mcp/surfaces/control-workflow/*`
  - shared preload workflow payload types
  - MCP workflow tests and renderer mocks
- Behavior impact:
  - RTT control profiles no longer silently require serial configuration for flash-observe.
  - RTT profiles return concrete RTT observation evidence instead of an empty observe phase.
  - Manual/download-only flows no longer report a failed download because post-flash RTT observation could not connect.
