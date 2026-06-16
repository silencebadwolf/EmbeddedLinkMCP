## ADDED Requirements

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
- **WHEN** a user edits baud rate, serial mode, debug interface, or J-Link speed
- **THEN** the UI provides dropdown options for common values

#### Scenario: Chip target remains editable
- **WHEN** the user needs a chip target that is not in common candidates
- **THEN** the UI allows manually typing the chip target

### Requirement: Workspace and firmware path selection

The control profile UI SHALL let the user choose the workspace directory and firmware file through native file dialogs.

#### Scenario: Workspace directory is selected
- **WHEN** the user chooses a workspace directory
- **THEN** the selected absolute path fills the workspace root field

#### Scenario: Firmware file is selected
- **WHEN** the user chooses a firmware file
- **THEN** the selected path fills the firmware path field
