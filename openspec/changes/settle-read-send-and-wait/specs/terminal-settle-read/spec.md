## MODIFIED Requirements

### Requirement: send_and_wait returns a bounded transcript observation

`send_and_wait` SHALL write through the existing session boundary, wait for a
finite settle interval, and return the filtered device-origin bytes observed
since the write. A completion marker MAY annotate the result but SHALL NOT be a
precondition for success.

#### Scenario: output without marker

- **WHEN** the device emits non-empty output during `settleMs`
- **AND** no supplied completion marker matches
- **THEN** the tool returns `success=true` with `reason='settled'`
- **AND** `hasDeviceOutput=true` and the output bytes are included

#### Scenario: large output and marker detector window

- **WHEN** the device emits more bytes than the completion detector's rolling
  buffer during `settleMs`
- **THEN** the returned observation remains independent of marker matching
- **AND** any observation cap is reported with `receivedTruncated` and
  `receivedTotalBytes`

#### Scenario: no output

- **WHEN** no non-echo device bytes arrive during `settleMs`
- **THEN** the tool returns `success=true` with `reason='settled'`
- **AND** `hasDeviceOutput=false` and an empty output payload
- **AND** the tool does not mark the session AI-unresponsive

#### Scenario: marker is present

- **WHEN** a supplied marker matches during `settleMs`
- **THEN** the result includes its marker index
- **AND** the tool still waits until the settle boundary before returning

### Requirement: settle timing is explicit and compatible

The MCP schema SHALL accept positive `settleMs`. Existing `timeoutMs` input
SHALL remain valid as a deprecated alias, and `settleMs` SHALL take precedence
when both are supplied.

#### Scenario: legacy timeout alias

- **WHEN** a caller supplies `timeoutMs=1000` and `settleMs=100`
- **THEN** the observation window is 100 milliseconds
- **AND** the request remains schema-valid for the legacy `timeoutMs` field
