## ADDED Requirements

### Requirement: Electron runtime resolver accepts preload API shape
LinkTerm SHALL resolve Electron APIs for both main-process modules and preload modules without rejecting valid preload-only Electron API objects.

#### Scenario: Preload exposes LinkTerm API
- **WHEN** `src/main/preload.ts` imports the shared Electron runtime resolver inside Electron preload
- **AND** the Electron module provides `contextBridge` and `ipcRenderer`
- **THEN** the resolver accepts that runtime API object
- **AND** the preload script can call `contextBridge.exposeInMainWorld('linkterm', api)`

#### Scenario: npm Electron wrapper is still rejected
- **WHEN** LinkTerm is launched through a plain Node process where `require('electron')` resolves to an executable path string
- **THEN** the resolver rejects that value with a structured runtime error
- **AND** LinkTerm does not continue with a missing Electron runtime API
