## Why

RTT log observation can connect to the SEGGER transport while still failing to consume the firmware's actual RTT up buffer. In the FNA1000 case, the target `_SEGGER_RTT` control block contained unread up0 data, but LinkTerm's App-visible RTT log session only showed the SEGGER banner and `rtt_read` did not advance the target `RdOff`.

The root cause is that LinkTerm's profile/root RTT path does not persist or pass a known RTT control block address, and the production RTT telnet client does not configure SEGGER RTT Telnet with that address. This leaves automatic observation dependent on control-block auto-discovery and makes UI/MCP behavior diverge from direct low-level evidence.

## What Changes

- Add an optional `rtt.controlBlockAddress` field to workspace control profiles as a hex string.
- Pass `rtt.controlBlockAddress` from profile/root RTT log opening into `IJLinkBackend.rttConnect`.
- Propagate `controlBlockAddress` from `JLinkAdapter.rttConnect` into the RTT telnet client.
- Configure the SEGGER RTT Telnet connection with `SetRTTAddr` immediately after socket connect when a control block address is provided.
- Keep existing behavior unchanged when no address is configured.
- Add UI save/open support so humans can persist and reload the RTT control block address from the control profile panel.

## Impact

- Affected code areas:
  - `src/core/workspace/control-profile-*`
  - `src/core/session/rtt-log-profile-target.ts`
  - `src/jlink/jlink-adapter.ts`
  - `src/jlink/segger-command-runner.ts`
  - `src/renderer/components/ControlProfilePanel.tsx`
  - RTT profile, MCP, IPC, J-Link adapter, and renderer tests
- Behavior impact:
  - Existing profiles without `rtt.controlBlockAddress` continue to work as before.
  - Profiles with a known control block address use deterministic SEGGER RTT Telnet attachment for automatic App/MCP RTT logs.
  - This change does not flash, reset, halt, or alter firmware.
