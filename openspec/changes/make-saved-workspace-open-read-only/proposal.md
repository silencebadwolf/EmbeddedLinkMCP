# Change: Make saved workspace opening read-only and recoverable

## Why

Opening a saved full workspace currently calls the control-profile initialization path with
`force: true`. The saved app-level record can therefore overwrite a newer
`<root>/.linkterm/control-profile.json` merely because the user clicked **Open workspace**.
Opening is expected to select and read a workspace, not rewrite its source-of-truth file.

The same flow also presents saved-connection failures poorly: a failed open can leave the user
on Start Center without a card-local explanation or a clear route to repair the saved entry.

## What changes

- Load the workspace-local control profile when a saved full workspace is opened.
- Never initialize, overwrite, or otherwise write the workspace-local profile from an open action.
- Use the freshly loaded profile for the opened workspace and observation session.
- Keep the saved record when loading or opening fails.
- Show the failure on the affected Start Center card and offer the existing workspace
  configuration surface as the recovery route.
- Apply the same visible open-failure behavior to serial-only saved workspaces.

## Scope

In scope: saved-workspace open IPC semantics, Start Center open state/error projection, bilingual
copy, and focused regression coverage.

Out of scope: terminal rendering, SSH host trust, workspace schema redesign, relocating a record
to a different root automatically, connection protocol changes, and hardware operations.

## Safety

No serial, RTT, J-Link, flash, erase, reset, or debug operation is executed by this change's
automated verification. Existing explicit open actions remain the only point that can create an
observation session.
