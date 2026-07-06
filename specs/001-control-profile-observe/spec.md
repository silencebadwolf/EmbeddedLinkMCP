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

### User Story 3 - Operate an opened control profile from its status area

As a LinkTerm user, when a control profile is open, I want connection controls, disconnection, and download progress to live in the same left-side status area so the profile, its live state, and its download evidence stay together.

**Acceptance Criteria**

1. Given an opened control profile, then the left-side status area shows Connect, Disconnect, and Download actions instead of requiring the configuration dialog for download.
2. Given the opened profile already has a live serial or RTT session, then Disconnect destroys that session and closes the associated status area.
3. Given observation auto-open failed and no session exists, then Connect retries the profile's configured serial or RTT observation and updates the status area with the new session state.
4. Given Download is running from the status area, then the status area shows an in-progress status bar.
5. Given Download completes or fails, then the status area shows the resulting summary, step statuses, duration values, and available evidence/error data.

## Requirements

- **FR-001**: Opening a saved control profile MUST publish the opened profile to a non-modal UI region separate from the editor dialog.
- **FR-002**: The detail region MUST include profile label, root, observation channel, J-Link target/interface/speed, firmware path/base address, and observation-specific facts.
- **FR-003**: Serial profiles MUST call the existing session creation preload API with `type='serial'`, configured `port`, `baudRate`, and `mode`.
- **FR-004**: RTT profiles MUST call the existing RTT log preload API with the opened profile root and the first configured channel, defaulting to channel `0`.
- **FR-005**: The detail region MUST reflect the current state of the associated session from renderer session metadata.
- **FR-006**: Observation auto-open failures MUST be shown in the detail region and MUST NOT erase the opened profile details.
- **FR-007**: Profiles that do not have a complete enabled serial or RTT observation channel MUST still show details and report that no observation session was opened.
- **FR-008**: The detail region MUST provide Connect and Disconnect actions bound to the same opened control profile lifecycle.
- **FR-009**: Disconnecting from the detail region MUST close the associated observation session and remove the detail region with it.
- **FR-010**: The Download action MUST be available from the detail region and MUST NOT remain as a primary action in the configuration dialog.
- **FR-011**: Download execution MUST show an in-progress status bar and MUST render completed step status, duration, summary, and evidence/error data returned by the existing download API.

## Out of Scope

- Editing multiple control profiles at once.
- Persisting the last opened control profile across app restarts.
- Changing MCP control workflow behavior.
- Adding new preload IPC channels.

## Success Criteria

- Targeted renderer tests cover serial auto-open, RTT auto-open, and status display.
- Existing control profile save/open/delete behavior remains intact.
- GitNexus change detection reports only expected renderer and spec artifacts for this feature.
