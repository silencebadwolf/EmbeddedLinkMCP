## Why

LinkTerm currently treats an in-memory J-Link handle as proof that a target chip is connected.
`JLinkAdapter.probeConnect()` can return `connected: true` without invoking SEGGER Commander or
touching SWD/JTAG, so a disconnected target is reported as connected. The download status bar
also mixes real Commander percentages with invented idle, step-count, failure, and pre-launch
percentages. These signals are unsafe because users cannot distinguish measured hardware facts
from renderer estimates.

## What Changes

- Require a successful, positive-evidence SEGGER target-access check before minting or reusing a
  connected probe handle.
- Revalidate a probe handle before reporting it as connected, and never merge unvalidated handles
  into physical probe discovery.
- Make manual chip connection and workflow `probeConnected` success inherit the same hardware
  evidence requirement.
- Remove invented download percentages and derived byte counts. Display a numeric percentage only
  when it comes from streamed Commander output, or 100% after a successful terminal result.
- Distinguish verified completion from an unverified Commander completion.
- Add regression tests for a physically absent target, stale handles, output without positive
  target evidence, and progress without a measured percentage.

## Scope

This change covers J-Link target-connection truth and download-progress truth. It does not add a
new probe driver, cloud service, telemetry, rollback promise, or hardware identity database. It
does not authorize real flash, erase, reset, or debug actions during automated verification.

## Impact

Expected implementation areas:

- `src/jlink/jlink-adapter.ts`
- `src/jlink/segger-command-runner.ts`
- `src/jlink/types.ts`
- `src/core/workspace/control-profile-chip.ts`
- `src/mcp/surfaces/control-workflow/workflow-runner.ts`
- `src/renderer/App.tsx`
- `src/renderer/i18n/en.ts` and `src/renderer/i18n/zh.ts`
- focused J-Link, workflow, IPC, and renderer tests
