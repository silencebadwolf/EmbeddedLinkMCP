# Start Center workspace model

## ADDED Requirements

### Requirement: Saved workspaces are the first home-screen task

The no-session Start Center SHALL render saved full and serial-only workspace summaries before the creation entry.

#### Scenario: Saved full and serial-only workspaces exist

- **WHEN** the renderer receives saved control-profile records and serial connection summaries
- **THEN** it renders bounded cards with labels, type badges, and device/link/firmware-safe details
- **AND** each card exposes `Open workspace` and a secondary `Delete workspace` action
- **AND** no card includes MCP, Agent, credential, or other system-only fields

#### Scenario: No saved workspaces exist

- **WHEN** both saved workspace sources are empty
- **THEN** the page shows a clear empty state and the `New device workspace` entry
- **AND** it does not enumerate or list current COM ports on the home page
- **AND** it does not render an advanced-device disclosure, readiness diagnostics, or a first-success shortcut

### Requirement: Saved workspaces can be deleted without affecting live sessions

The Start Center SHALL allow a user to delete either saved workspace kind after explicit confirmation.

#### Scenario: User deletes a full workspace

- **WHEN** the user confirms deletion of a full workspace card
- **THEN** the renderer calls the existing control-profile record deletion API
- **AND** the card is removed after storage confirms success

#### Scenario: User deletes a serial-only workspace

- **WHEN** the user confirms deletion of a serial-only workspace card
- **THEN** the renderer calls the existing saved-connection deletion API
- **AND** the card is removed after storage confirms success

#### Scenario: Deletion is cancelled or fails

- **WHEN** the user cancels confirmation or storage returns an error
- **THEN** the saved workspace remains visible
- **AND** a storage error is presented to the user
- **AND** no active session is destroyed or disconnected

### Requirement: New device workspace has two setup scopes

The creation entry SHALL offer `Serial-only connection` and `Full device workspace`.

#### Scenario: User needs a one-off serial terminal

- **WHEN** the user selects `Serial-only connection`
- **THEN** the panel delegates to the existing ConnectionDialog
- **AND** the user can open a temporary serial session without filling full device, J-Link, RTT, or firmware fields
- **AND** the serial picker and baud validation appear only inside ConnectionDialog

#### Scenario: User needs a persistent serial workspace

- **WHEN** the user saves the serial connection from the existing connection flow
- **THEN** the saved serial profile is shown on the next Start Center load as a serial-only workspace
- **AND** opening it uses the existing connections.open and SessionManager path

#### Scenario: User needs a full device workspace

- **WHEN** the user selects `Full device workspace`
- **THEN** the existing control-profile fields for device links and firmware are shown
- **AND** saving and opening preserve the existing control-profile IPC and observation behavior

### Requirement: MCP and Agent configuration is system-level

MCP injection and Agent settings SHALL remain outside device workspace data and SHALL be reachable from application chrome.

#### Scenario: User changes workspaces

- **WHEN** the user opens a different device workspace
- **THEN** the global MCP/Agent configuration is not copied, reset, or overwritten
- **AND** workspace cards do not display MCP/Agent fields

### Requirement: Shared human and AI terminal boundary is preserved

Workspace-first UI changes SHALL continue to use the existing session and terminal input boundaries.

#### Scenario: AI activity is visible during a session

- **WHEN** Activity Center is opened while a terminal session is active
- **THEN** human input remains available in that terminal
- **AND** AI and human output remain in the same session transcript
- **AND** no approval, pause, takeover, recovery, or mutual-exclusion control is shown
