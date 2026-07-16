## ADDED Requirements

### Requirement: Start Center makes opening a serial terminal the primary task

LinkTerm SHALL present one primary no-session action for opening a serial terminal. Detected serial candidates and manual serial entry SHALL be presented as one serial-device area with consistent open-terminal actions. Saved connection profiles SHALL remain in the existing ConnectionDialog instead of being duplicated as incomplete Start Center rows. The Start Center MUST continue to use the existing ConnectionDialog, SessionManager, Transport, and WriteQueue boundaries.

#### Scenario: User opens a detected serial port
- **WHEN** a serial candidate is available
- **THEN** the user sees an explicit `Open serial terminal` action for that candidate
- **AND** activating it follows the existing serial connection path
- **AND** no readiness, Agent, J-Link, RTT, approval, or pause step is required first

#### Scenario: User enters a manual serial port
- **WHEN** no candidate is suitable and the user enters a port and baud rate
- **THEN** the same serial-device area shows one explicit open-terminal action
- **AND** invalid fields show a local actionable reason
- **AND** no transport is opened until the existing explicit connection action runs

#### Scenario: User uses a saved connection configuration
- **WHEN** the user activates `Open serial terminal`
- **THEN** the existing ConnectionDialog exposes its saved connection profiles
- **AND** Start Center does not show a second incomplete copy of those profiles
- **AND** opening a saved profile continues through the existing explicit connection action

### Requirement: Advanced device information is secondary

LinkTerm SHALL keep J-Link, RTT, firmware, Agent, control-profile, compensation, and detailed diagnostics in a collapsed `Advanced devices` area on Start Center. Advanced checks MUST NOT block or visually replace the primary serial-terminal path.

#### Scenario: Start Center has advanced readiness findings
- **WHEN** J-Link, RTT, Agent, or diagnostic findings exist
- **THEN** Start Center shows a compact summary and keeps details collapsed by default
- **AND** expanding the area preserves existing explicit-action safety behavior

### Requirement: No-session Start Center does not render the control-profile sidebar

When there is no active session, First Success review, or J-Link/RTT review, LinkTerm SHALL give Start Center the full main-canvas width and SHALL NOT render the control-profile record sidebar. Active-session and control-profile workflows SHALL retain their existing sidebar behavior.

#### Scenario: App starts with no session
- **WHEN** the app has no active session and shows Start Center
- **THEN** the control-profile sidebar is absent
- **AND** the serial-device area uses the available main width

#### Scenario: User has an active session
- **WHEN** a session or control-profile review is active
- **THEN** the terminal/review remains primary
- **AND** existing control-profile sidebar behavior is preserved

### Requirement: Activity Center remains observation-only and non-blocking

Activity Center SHALL be closed by default on Start Center and remain an observation/audit drawer. Opening or closing it MUST NOT change terminal focus, disable human input, request approval, pause AI, resume AI, or take over a session.

#### Scenario: AI activity is visible while the user types
- **WHEN** AI activity is shown while a terminal session has focus
- **THEN** the user can continue typing through the existing terminal input boundary
- **AND** Activity Center only displays observation/audit information

### Requirement: Clear Start Center UI is bilingual, accessible, and responsive

All new or changed labels, actions, statuses, validation messages, and disclosure states SHALL have consistent English and Chinese translations. The primary action, serial fields, candidate rows, advanced disclosure, and Activity Center trigger SHALL be keyboard reachable and have explicit accessible names. The layout SHALL stack without horizontal overflow at narrow widths.

#### Scenario: User navigates by keyboard
- **WHEN** the user tabs through Start Center
- **THEN** the serial primary action, port fields, candidate actions, advanced disclosure, and Activity Center trigger are reachable
- **AND** disclosure state is exposed through accessible state

#### Scenario: Window is narrow
- **WHEN** the app window is reduced to a narrow desktop width
- **THEN** serial controls remain visible and usable
- **AND** advanced content does not push the primary action off-screen or introduce horizontal scrolling
