## MODIFIED Requirements

### Requirement: Workspace and firmware path selection

The control profile UI SHALL let the user choose the workspace directory and firmware file through native file dialogs, and on Windows the workspace directory picker SHALL expose available WSL workspaces with parity to firmware file browsing.

#### Scenario: Workspace directory is selected
- **WHEN** the user chooses a workspace directory
- **THEN** the selected absolute path fills the workspace root field

#### Scenario: WSL workspace directory is discoverable on Windows
- **GIVEN** LinkTerm is running on Windows
- **AND** at least one WSL distribution or WSL share is available
- **WHEN** the user opens the workspace directory picker
- **THEN** LinkTerm opens the native directory dialog at an available WSL UNC home or root path
- **AND** the user can select a WSL workspace directory for the workspace root field

#### Scenario: Workspace directory picker falls back when WSL is unavailable
- **GIVEN** LinkTerm is running on Windows
- **AND** WSL discovery is unavailable
- **WHEN** the user opens the workspace directory picker
- **THEN** LinkTerm still opens the native directory dialog for local workspace folders

#### Scenario: Firmware file is selected
- **WHEN** the user chooses a firmware file
- **THEN** the selected path fills the firmware path field
