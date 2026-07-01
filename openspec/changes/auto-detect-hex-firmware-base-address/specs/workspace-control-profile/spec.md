## MODIFIED Requirements

### Requirement: Workspace and firmware path selection

The control profile UI SHALL let the user choose the workspace directory and firmware file through native file dialogs. When the selected firmware is an Intel HEX file, LinkTerm SHALL detect the lowest absolute data address and make it available as the flash base address.

#### Scenario: Workspace directory is selected
- **WHEN** the user chooses a workspace directory
- **THEN** the selected absolute path fills the workspace root field

#### Scenario: Firmware file is selected
- **WHEN** the user chooses a firmware file
- **THEN** the selected path fills the firmware path field

#### Scenario: Intel HEX firmware base address is detected
- **WHEN** the user chooses a valid Intel HEX firmware file containing data records
- **THEN** LinkTerm parses the HEX address records
- **AND** fills the flash base address field with the lowest absolute data address in `0x...` format

#### Scenario: Non-HEX firmware selection is unchanged
- **WHEN** the user chooses a non-HEX firmware file
- **THEN** LinkTerm fills the firmware path field
- **AND** does not change the flash base address based on file contents

### Requirement: Destructive flash workflow uses decoded firmware bytes

LinkTerm SHALL decode Intel HEX firmware before invoking raw binary flash download workflows.

#### Scenario: Intel HEX firmware is flashed as bytes, not text
- **GIVEN** a control profile references a valid Intel HEX firmware file
- **AND** `flash.baseAddress` matches the lowest HEX data address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm decodes the Intel HEX data records into raw bytes
- **AND** passes decoded bytes and the detected base address to the J-Link raw flash backend
- **AND** does not pass ASCII HEX record text as the firmware image

#### Scenario: Intel HEX configured address mismatch is rejected
- **GIVEN** a control profile references a valid Intel HEX firmware file
- **AND** `flash.baseAddress` differs from the lowest HEX data address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm rejects the workflow before connecting to the probe
- **AND** reports that the configured base address does not match the HEX image address
