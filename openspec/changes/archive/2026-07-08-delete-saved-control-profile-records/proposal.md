# Delete Saved Control Profile Records

## Why
Saved control profile records can be created from both AI-assisted and manual configuration flows, but the UI only lets users reopen them. Users need a way to remove stale or incorrect records without editing local storage by hand.

## What
- Add a delete action beside each saved control profile record in the control profile UI.
- Remove a successfully deleted record from the list immediately.
- Surface deletion failures through the existing error message area.

## Scope
- Renderer control profile panel behavior.
- Renderer i18n text for the new action and status.
- Tests covering successful and failed deletion.

## Out of Scope
- Changing record persistence format.
- Bulk delete or undo.
- Deleting the workspace `.linkterm/control-profile.json` file itself.
