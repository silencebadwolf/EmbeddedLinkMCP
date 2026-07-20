# Design

## Root cause

`CONTROL_PROFILE_RECORDS_OPEN` resolves an app-level record and passes its cached profile to
`ControlProfileManager.init(root, body, { force: true })`. `init` performs an atomic write to the
workspace-local file. The read-looking IPC operation therefore has a hidden destructive side
effect and treats the cache as newer than the workspace source of truth.

## Decision: workspace file is authoritative on open

The open handler will call `ControlProfileManager.load(record.root)`. It will return a transient
opened-record projection that preserves the stable record identity, label, source, and timestamps
while replacing only `profile` with the freshly loaded file content.

The handler will not call `ControlProfileRecordManager.save` while opening. This keeps opening
read-only for both the workspace file and the app-level saved-record store. Persistently refreshing
or relocating a saved record requires a separate explicit save/repair action.

## Renderer error model

App will track the workspace id currently being opened and a card-local open error. Start Center
will serialize saved-workspace activation by disabling other open/delete actions until that request
settles, render the error beside the affected card, and expose a repair action
that opens the existing device-workspace configuration surface. Full workspaces enter that surface
with the affected cached record's root and profile prefilled, while serial-only workspaces enter the
shared connection dialog with the saved non-sensitive serial fields prefilled. The failed record
remains listed; no session is created or destroyed by the error path.

Serial-only saved connection failures use the same renderer state even though their Main IPC path
is different. This keeps the user's recovery experience consistent without changing SessionManager
or transport behavior.

## Compatibility

The preload payload shape remains unchanged. Existing callers still receive
`{ path, record }`; the returned `record.profile` now reflects the workspace file rather than a
forced rewrite of that file. No schema version changes are required.
