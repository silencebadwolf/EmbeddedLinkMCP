# Design

## Approach
The preload API already exposes `controlProfile.deleteRecord({ recordId })`, so the renderer should call that existing capability from the saved records list.

The panel will track a single `deletingRecordId` just like `openingRecordId`. While a record is being deleted, its delete button shows a pending label and is disabled. On success, the record is filtered out of local `savedRecords`; on failure, the existing error alert displays the backend message and the record stays visible.

## UI
Each saved record row will contain an action group with:
- Open profile
- Delete profile

The action text uses the existing i18n dictionary in English and Chinese.

## Risks
The blast radius is local to the control profile panel. The main risk is accidental removal of a row before the backend confirms deletion, so the UI only mutates the list after a successful preload response.
