## MODIFIED Requirements

### Requirement: Workspace and firmware path selection

The control profile UI SHALL let the user choose the workspace directory and firmware file through native file dialogs. When the selected firmware is an Intel HEX or ELF file, LinkTerm SHALL detect the load address and make it available as the flash base address.

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

#### Scenario: ELF firmware base address is detected

- **WHEN** the user chooses a valid ELF firmware file containing loadable flash segments
- **THEN** LinkTerm parses the ELF program headers
- **AND** fills the flash base address field with the lowest load address in `0x...` format

#### Scenario: Raw binary firmware selection is unchanged

- **WHEN** the user chooses a raw `.bin` firmware file
- **THEN** LinkTerm fills the firmware path field
- **AND** does not change the flash base address based on file contents

### Requirement: Destructive flash workflow uses decoded firmware bytes

LinkTerm SHALL decode Intel HEX and ELF firmware before invoking raw binary flash download workflows.

#### Scenario: Intel HEX firmware is flashed as bytes, not text

- **GIVEN** a control profile references a valid Intel HEX firmware file
- **AND** `flash.baseAddress` matches the lowest HEX data address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm decodes the Intel HEX data records into raw bytes
- **AND** passes decoded bytes and the detected base address to the J-Link raw flash backend
- **AND** does not pass ASCII HEX record text as the firmware image

#### Scenario: ELF firmware is flashed as load image bytes, not ELF headers

- **GIVEN** a control profile references a valid ELF firmware file
- **AND** `flash.baseAddress` matches the lowest ELF load address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm decodes the ELF loadable program segments into raw bytes
- **AND** passes decoded bytes and the detected load address to the J-Link raw flash backend
- **AND** does not pass the ELF file header as the firmware image

#### Scenario: ELF configured address mismatch is rejected

- **GIVEN** a control profile references a valid ELF firmware file
- **AND** `flash.baseAddress` differs from the lowest ELF load address
- **WHEN** a confirmed flash workflow runs
- **THEN** LinkTerm rejects the workflow before connecting to the probe
- **AND** reports that the configured base address does not match the ELF image address
