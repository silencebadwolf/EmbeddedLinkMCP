## ADDED Requirements

### Requirement: Saved control profile record deletion

The control profile UI SHALL allow users to delete saved control profile records created by either AI-assisted or manual configuration flows.

#### Scenario: Record is deleted from the saved list
- **GIVEN** the control profile UI is showing a saved control profile record
- **WHEN** the user deletes that record
- **THEN** LinkTerm calls the saved record deletion API with that record id
- **AND** the record is removed from the saved list after the API succeeds
- **AND** the record is not opened or applied to the form by deleting it

#### Scenario: Deletion failure is visible
- **GIVEN** the control profile UI is showing a saved control profile record
- **WHEN** deleting that record fails
- **THEN** LinkTerm keeps the record in the saved list
- **AND** the UI displays the deletion error message
