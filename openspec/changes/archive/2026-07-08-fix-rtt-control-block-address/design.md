## Design

### Control Profile

Add `rtt.controlBlockAddress?: string` using the existing `0x...` hexadecimal address format. The field is optional because many projects can still rely on SEGGER auto-discovery. When present, LinkTerm parses it to a uint32 only at the J-Link backend boundary.

### RTT Backend

Extend `JLinkRttConnectOptions` with `controlBlockAddress?: number`. `JLinkAdapter.rttConnect` already accepts this option through `IJLinkBackend`; the fix is to pass it to the `JLinkRttClient`.

`NetJLinkRttClient.connect` keeps the current TCP RTT Telnet transport. When `controlBlockAddress` is supplied, it writes the SEGGER RTT Telnet config string during the initial connection window:

```text
$$SEGGER_TELNET_ConfigStr=SetRTTAddr;0x24005310$$
```

This uses SEGGER's supported Telnet configuration path instead of spawning external tools or trying to read the target ring buffer with a second J-Link process.

### App/MCP Flow

`prepareProfileRttLogTarget` loads the profile, parses `rtt.controlBlockAddress`, and calls `rttConnect(probeId, { controlBlockAddress })` when available. Both MCP `open_rtt_log_session(root=...)` and App IPC `rttLog.open(root=...)` already share this target preparation function, so the behavior stays aligned.

`apply_control_profile_answer` treats a parsed natural-language answer as a patch over the existing profile instead of replacing the entire file. This prevents a follow-up answer such as `_SEGGER_RTT=0x24005310` from dropping existing J-Link or flash fields. When the answer selects RTT observation, the merge removes a prior serial observation section to keep the existing serial-vs-RTT exclusivity rule intact.

### UI

The control profile panel gets a visible RTT control block address input only when RTT observation is selected. Saved profiles and saved profile records round-trip the field.

### Non-Goals

- No direct RTT control block parser in this change.
- No firmware linker/MPU/cache changes.
- No flash/debug workflow retry changes.
