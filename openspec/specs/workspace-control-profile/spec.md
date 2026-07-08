# workspace-control-profile Specification

## Purpose
TBD - created by archiving change workspace-control-profile. Update Purpose after archive.
## Requirements
### Requirement: Workspace-local control profile file

LinkTerm SHALL persist hardware control facts in `<workspace>/.linkterm/control-profile.json` using schema version `linkterm-control/1.0.0`.

#### Scenario: Profile is created from MCP or UI
- **WHEN** a caller initializes or saves a control profile for an absolute workspace root
- **THEN** LinkTerm writes `.linkterm/control-profile.json` under that root
- **AND** the persisted file includes `schemaVersion: "linkterm-control/1.0.0"`

#### Scenario: Missing profile blocks activation
- **WHEN** `activate_control_profile` is called for a workspace without `.linkterm/control-profile.json`
- **THEN** the tool returns `CONTROL_PROFILE_NOT_FOUND`
- **AND** it does not guess serial, J-Link, flash, or RTT values

### Requirement: Hexadecimal flash base address

LinkTerm SHALL store `flash.baseAddress` only as a hexadecimal string in `0x...` format.

#### Scenario: Hex address is accepted
- **WHEN** the user provides `0x08000000` as the flash base address
- **THEN** the value is accepted and persisted unchanged

#### Scenario: Decimal address is rejected
- **WHEN** the user provides `134217728` as the flash base address
- **THEN** the value is rejected or reported as needing clarification
- **AND** LinkTerm does not convert it implicitly

### Requirement: MCP control profile lifecycle

LinkTerm SHALL expose MCP tools to create, read, inspect, ask for missing fields, apply human answers, and activate a workspace control profile.

#### Scenario: Human answer fills profile
- **WHEN** a human answer contains serial port, baud rate, chip target, debug interface, J-Link speed, firmware path, and hex flash address
- **THEN** MCP parses those facts into the workspace control profile
- **AND** reports parsed fields and any rejected fields

#### Scenario: Activation is non-destructive
- **WHEN** a complete control profile is activated
- **THEN** LinkTerm may open the configured serial session and connect the configured J-Link probe
- **AND** it SHALL NOT flash, erase, reset, halt, run CPU, or start a GDB server

### Requirement: J-Link auto speed fallback

LinkTerm SHALL support `jlink.speedKHz` as either a positive numeric kHz value or the literal `auto`.

#### Scenario: Numeric speed is used directly
- **WHEN** `jlink.speedKHz` is `4000`
- **THEN** MCP passes `4000` kHz to the J-Link backend

#### Scenario: Auto speed starts high and falls back
- **WHEN** `jlink.speedKHz` is `auto`
- **THEN** MCP attempts J-Link connection from the highest configured speed downward
- **AND** if a high speed fails with a recoverable J-Link operation failure, MCP tries the next lower speed

### Requirement: Bilingual control profile UI

The control profile UI SHALL use the existing LinkTerm i18n mechanism for all visible text.

#### Scenario: Locale is Chinese
- **WHEN** the app locale is `zh`
- **THEN** the control profile entry, labels, buttons, and messages are displayed in Chinese

#### Scenario: Locale is English
- **WHEN** the app locale is `en`
- **THEN** the control profile entry, labels, buttons, and messages are displayed in English

### Requirement: Human-friendly selectors

The control profile UI SHALL provide selectors or candidates for common values while preserving user control where necessary.

#### Scenario: Common values are selected
- **WHEN** a user edits serial mode, debug interface, or J-Link speed
- **THEN** the UI provides dropdown options for common values

#### Scenario: Baud rate remains manually editable
- **WHEN** a user edits baud rate
- **THEN** the UI allows typing an arbitrary positive numeric baud rate
- **AND** the UI provides common baud rates as quick selections

#### Scenario: Chip target remains editable
- **WHEN** the user needs a chip target that is not in common candidates
- **THEN** the UI allows manually typing the chip target

### Requirement: Workspace and firmware path selection

The control profile UI SHALL let the user choose the workspace directory and firmware file through native file dialogs. When the selected firmware is an Intel HEX or ELF file, LinkTerm SHALL detect the load address and make it available as the flash base address.

#### Scenario: Workspace directory is selected

- **WHEN** the user chooses a workspace directory
- **THEN** the selected absolute path fills the workspace root field

#### Scenario: Firmware file is selected

- **WHEN** the user chooses a firmware file
- **THEN** the selected path fills the firmware path field

#### Scenario: Intel HEX firmware base address is detected

- **WHEN** the user chooses a valid Intel HEX firmware file containing data records
- **THEN** LinkTerm parses the HEX address records
- **AND** fills the flash base address field with the lowest absolute data address in `0x...` format

#### Scenario: ELF firmware base address is detected

- **WHEN** the user chooses a valid ELF firmware file containing loadable flash segments
- **THEN** LinkTerm parses the ELF program headers
- **AND** fills the flash base address field with the lowest load address in `0x...` format

#### Scenario: Raw binary firmware selection is unchanged

- **WHEN** the user chooses a raw `.bin` firmware file
- **THEN** LinkTerm fills the firmware path field
- **AND** does not change the flash base address based on file contents

### Requirement: RTT control block address can be persisted in control profiles

LinkTerm SHALL allow workspace control profiles to persist an optional RTT control block address for deterministic J-Link RTT attachment.

#### Scenario: Hex RTT control block address is accepted

- **WHEN** a caller saves a control profile with `rtt.enabled=true` and `rtt.controlBlockAddress="0x24005310"`
- **THEN** LinkTerm SHALL accept and persist the address unchanged
- **AND** the saved profile SHALL remain schema version `linkterm-control/1.0.0`

#### Scenario: Decimal RTT control block address is rejected

- **WHEN** a caller saves a control profile with `rtt.controlBlockAddress="604001040"`
- **THEN** LinkTerm SHALL reject the profile
- **AND** it SHALL NOT silently convert the decimal value

#### Scenario: RTT address round-trips through the App panel

- **GIVEN** a saved control profile record has `rtt.controlBlockAddress="0x24005310"`
- **WHEN** a user opens that saved profile in the App control profile panel
- **THEN** the RTT control block address field SHALL show `0x24005310`

#### Scenario: RTT control block answer does not alter flash base

- **WHEN** a caller answers a control-profile prompt with `RTT 日志，_SEGGER_RTT=0x24005310` or `_SEGGER_RTT=0x24005310`
- **THEN** LinkTerm SHALL parse `0x24005310` as `rtt.controlBlockAddress`
- **AND** it SHALL NOT write or overwrite `flash.baseAddress`

#### Scenario: RTT control block answer preserves existing profile facts

- **GIVEN** an existing control profile has `jlink` and `flash` sections
- **WHEN** a caller applies an answer containing only `RTT 日志，_SEGGER_RTT=0x24005310`
- **THEN** LinkTerm SHALL preserve the existing `jlink` and `flash` sections
- **AND** it SHALL set `rtt.controlBlockAddress="0x24005310"`
- **AND** it SHALL remove any prior enabled serial observation section so the profile still has exactly one observation channel

### Requirement: Profile-based RTT open uses the configured control block address

When a profile-based RTT log session is opened and the profile has `rtt.controlBlockAddress`, LinkTerm SHALL pass that address to the J-Link RTT connection.

#### Scenario: MCP opens RTT log with configured control block

- **GIVEN** a workspace profile has `jlink.enabled=true`, `rtt.enabled=true`, and `rtt.controlBlockAddress="0x24005310"`
- **WHEN** `open_rtt_log_session` is called with that workspace `root`
- **THEN** LinkTerm SHALL call the J-Link backend RTT connect operation with `controlBlockAddress=0x24005310`
- **AND** the App-visible RTT log session SHALL use the selected RTT up channel from that connection

#### Scenario: Profile omits RTT control block

- **GIVEN** a workspace profile has `rtt.enabled=true` but no `rtt.controlBlockAddress`
- **WHEN** profile-based RTT log open prepares the J-Link backend
- **THEN** LinkTerm SHALL preserve the existing auto-discovery behavior
- **AND** it SHALL NOT invent or guess an address

### Requirement: RTT control profiles drive RTT workflow observation

When a workspace control profile enables RTT observation, LinkTerm SHALL use RTT as the default observation channel for high-level flash workflows.

#### Scenario: RTT profile flash-observe uses RTT instead of serial

- **GIVEN** a control profile has `rtt.enabled=true`
- **AND** it does not have `serial.enabled=true`
- **WHEN** `run_control_workflow` runs in `flash-observe` mode
- **THEN** LinkTerm SHALL NOT open a serial session
- **AND** LinkTerm SHALL connect RTT through the managed J-Link backend
- **AND** LinkTerm SHALL read the selected RTT up-channel after reset
- **AND** the workflow summary SHALL report `rttObserved=true` when markers are observed

#### Scenario: Explicit serial request overrides RTT default

- **GIVEN** a control profile has `rtt.enabled=true`
- **WHEN** `run_control_workflow` is called with `observe.serial=true`
- **THEN** LinkTerm SHALL use serial observation
- **AND** LinkTerm SHALL NOT run RTT observation steps for that workflow

#### Scenario: Download-only workflow disables observation

- **GIVEN** a control profile has `rtt.enabled=true`
- **WHEN** `run_control_workflow` runs a flash workflow with `observe.enabled=false`
- **THEN** LinkTerm SHALL flash and verify the configured firmware
- **AND** LinkTerm SHALL reset the target when the workflow mode requires reset
- **AND** LinkTerm SHALL NOT start a managed GDB server
- **AND** LinkTerm SHALL NOT connect serial or RTT observation channels

#### Scenario: Managed GDB server is stopped after RTT workflows

- **GIVEN** a control profile has `rtt.enabled=true`
- **AND** a high-level workflow starts a managed GDB server for RTT observation or diagnosis
- **WHEN** the workflow succeeds or fails after that server is started
- **THEN** LinkTerm SHALL stop the managed GDB server before returning final workflow evidence
- **AND** the final workflow evidence SHALL include a `gdb_server_stop` step
- **AND** a post-flash RTT connection failure SHALL preserve `summary.flashed=true` and `summary.verified=true`
- **AND** the workflow SHALL report `failureCode=rtt_connect_failed` with a next action that avoids repeating flash unnecessarily

### Requirement: Destructive flash workflow uses decoded firmware bytes

LinkTerm SHALL decode Intel HEX and ELF firmware before invoking raw binary flash download workflows.

#### Scenario: Intel HEX firmware is flashed as bytes, not text

- **GIVEN** a control profile references a valid Intel HEX firmware file
- **AND** `flash.baseAddress` matches the lowest HEX data address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm decodes the Intel HEX data records into raw bytes
- **AND** passes decoded bytes and the detected base address to the J-Link raw flash backend
- **AND** does not pass ASCII HEX record text as the firmware image

#### Scenario: Intel HEX configured address mismatch is rejected

- **GIVEN** a control profile references a valid Intel HEX firmware file
- **AND** `flash.baseAddress` differs from the lowest HEX data address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm rejects the workflow before connecting to the probe
- **AND** reports that the configured base address does not match the HEX image address

#### Scenario: ELF firmware is flashed as load image bytes, not ELF headers

- **GIVEN** a control profile references a valid ELF firmware file
- **AND** `flash.baseAddress` matches the lowest ELF load address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm decodes the ELF loadable program segments into raw bytes
- **AND** passes decoded bytes and the detected load address to the J-Link raw flash backend
- **AND** does not pass the ELF file header as the firmware image

#### Scenario: ELF configured address mismatch is rejected

- **GIVEN** a control profile references a valid ELF firmware file
- **AND** `flash.baseAddress` differs from the lowest ELF load address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm rejects the workflow before connecting to the probe
- **AND** reports that the configured base address does not match the ELF image address
