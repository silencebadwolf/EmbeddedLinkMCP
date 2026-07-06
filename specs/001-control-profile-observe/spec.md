# Feature Specification: Control Profile Details and Observation Auto-Open

**Feature Branch**: local working tree
**Created**: 2026-07-06
**Status**: Approved
**Input**: "增加一个新功能，打开配置后，给一个单独的区域显示配置详情，和实时状态，并且自动打开，打开配置的串口或者rtt日志"

## User Stories & Tests

### User Story 1 - Open a saved serial control profile

As a LinkTerm user, when I open a saved workspace control profile that uses serial observation, I want the app to show the profile details in a separate main-screen area and automatically open the configured serial session so I can see live connection status immediately.

**Acceptance Criteria**

1. Given a saved control profile with `serial.enabled=true`, when the user opens it, then a main-screen profile detail area shows the profile label, workspace root, serial port, baud rate, J-Link target, and firmware facts.
2. Given the same profile, when opening succeeds, then LinkTerm creates a serial session using the profile's port, baud rate, and mode.
3. Given the serial session state later changes in the renderer store, then the profile detail area reflects the new state.

### User Story 2 - Open a saved RTT control profile

As a LinkTerm user, when I open a saved workspace control profile that uses RTT observation, I want the app to show the profile details and automatically open the RTT log tab using the profile's workspace root.

**Acceptance Criteria**

1. Given a saved profile with `rtt.enabled=true`, when the user opens it, then LinkTerm opens an RTT log session with the saved workspace root and selected RTT channel.
2. Given the RTT open result returns a resolved probe/channel, then the detail area shows the RTT channel and associated session status.
3. Given RTT opening fails, then the detail area remains visible and shows the failure message.

## Requirements

- **FR-001**: Opening a saved control profile MUST publish the opened profile to a non-modal UI region separate from the editor dialog.
- **FR-002**: The detail region MUST include profile label, root, observation channel, J-Link target/interface/speed, firmware path/base address, and observation-specific facts.
- **FR-003**: Serial profiles MUST call the existing session creation preload API with `type='serial'`, configured `port`, `baudRate`, and `mode`.
- **FR-004**: RTT profiles MUST call the existing RTT log preload API with the opened profile root and the first configured channel, defaulting to channel `0`.
- **FR-005**: The detail region MUST reflect the current state of the associated session from renderer session metadata.
- **FR-006**: Observation auto-open failures MUST be shown in the detail region and MUST NOT erase the opened profile details.
- **FR-007**: Profiles that do not have a complete enabled serial or RTT observation channel MUST still show details and report that no observation session was opened.

## Out of Scope

- Editing multiple control profiles at once.
- Persisting the last opened control profile across app restarts.
- Changing MCP control workflow behavior.
- Adding new preload IPC channels.

## Success Criteria

- Targeted renderer tests cover serial auto-open, RTT auto-open, and status display.
- Existing control profile save/open/delete behavior remains intact.
- GitNexus change detection reports only expected renderer and spec artifacts for this feature.
