## ADDED Requirements

### Requirement: opening a saved full workspace is read-only

LinkTerm SHALL treat the workspace-local control profile as the source of truth when opening a
saved full workspace. The open action MUST NOT initialize, overwrite, or otherwise write either
the workspace-local profile or the saved-record store.

#### Scenario: workspace profile changed after the saved record was created

- **GIVEN** a saved record contains an older profile snapshot
- **AND** `<root>/.linkterm/control-profile.json` contains a newer valid profile
- **WHEN** the user opens the saved workspace
- **THEN** LinkTerm loads and returns the newer workspace-local profile
- **AND** it preserves the saved record identity and display label
- **AND** it does not call a force-initialize or record-save path

#### Scenario: workspace profile is missing or invalid

- **WHEN** the saved record points to a missing, unreadable, or invalid control profile
- **THEN** opening fails without writing a replacement file
- **AND** no observation session is created
- **AND** the saved record remains available for repair or deletion

### Requirement: saved workspace open failures are visible and recoverable

Start Center SHALL associate an open failure with the affected saved workspace instead of silently
returning or replacing the whole saved-workspace list.

#### Scenario: full workspace open fails

- **WHEN** opening a saved full workspace fails
- **THEN** its card shows the returned error
- **AND** offers the existing device-workspace configuration surface as a repair route
- **AND** leaves other saved workspace cards usable

#### Scenario: serial-only workspace open fails

- **WHEN** opening a saved serial-only workspace fails
- **THEN** its card shows the returned error and repair route
- **AND** no failed or ghost session is added to the renderer

### Requirement: opening state prevents duplicate activation

Start Center SHALL identify the saved workspace currently being opened and prevent duplicate
activation until the request settles.

#### Scenario: user activates the same card repeatedly

- **WHEN** a saved workspace open request is pending
- **THEN** that card's open action is disabled and displays an opening state
- **AND** delete remains protected from racing the pending open

#### Scenario: user activates a different card while opening is pending

- **WHEN** any saved workspace open request is pending
- **THEN** other saved-workspace open and delete actions remain disabled until it settles
- **AND** at most one activation request can create a session from Start Center at a time
