## ADDED Requirements

### Requirement: RTT control profiles drive RTT workflow observation

When a workspace control profile enables RTT observation, LinkTerm SHALL use RTT as the default observation channel for high-level flash workflows.

#### Scenario: RTT profile flash-observe uses RTT instead of serial

- **GIVEN** a control profile has `rtt.enabled=true`
- **AND** it does not have `serial.enabled=true`
- **WHEN** `run_control_workflow` runs in `flash-observe` mode
- **THEN** LinkTerm SHALL NOT open a serial session
- **AND** LinkTerm SHALL connect RTT through the managed J-Link backend
- **AND** LinkTerm SHALL read the selected RTT up-channel after reset
- **AND** the workflow summary SHALL report `rttObserved=true` when markers are observed

#### Scenario: Explicit serial request overrides RTT default

- **GIVEN** a control profile has `rtt.enabled=true`
- **WHEN** `run_control_workflow` is called with `observe.serial=true`
- **THEN** LinkTerm SHALL use serial observation
- **AND** LinkTerm SHALL NOT run RTT observation steps for that workflow

#### Scenario: Download-only workflow disables observation

- **GIVEN** a control profile has `rtt.enabled=true`
- **WHEN** `run_control_workflow` runs a flash workflow with `observe.enabled=false`
- **THEN** LinkTerm SHALL flash and verify the configured firmware
- **AND** LinkTerm SHALL reset the target when the workflow mode requires reset
- **AND** LinkTerm SHALL NOT start a managed GDB server
- **AND** LinkTerm SHALL NOT connect serial or RTT observation channels

#### Scenario: Managed GDB server is stopped after RTT workflows

- **GIVEN** a control profile has `rtt.enabled=true`
- **AND** a high-level workflow starts a managed GDB server for RTT observation or diagnosis
- **WHEN** the workflow succeeds or fails after that server is started
- **THEN** LinkTerm SHALL stop the managed GDB server before returning final workflow evidence
- **AND** the final workflow evidence SHALL include a `gdb_server_stop` step
- **AND** a post-flash RTT connection failure SHALL preserve `summary.flashed=true` and `summary.verified=true`
- **AND** the workflow SHALL report `failureCode=rtt_connect_failed` with a next action that avoids repeating flash unnecessarily
