# Discoverable Start Center entries

## ADDED Requirements

### Requirement: Show saved connections before manual open

The Start Center SHALL render saved global connection summaries before the manual-open action. It SHALL NOT render a current serial-port candidate list or an independent manual-serial form.

#### Scenario: Saved profiles exist

- **WHEN** Start Center receives saved connection summaries
- **THEN** it shows each visible profile label and a clear `Open` action
- **AND** opening a profile invokes the existing App callback without writing to the transport from readiness

#### Scenario: No saved profiles exist

- **WHEN** the saved connection list is empty
- **THEN** it shows a clear saved-connection empty state
- **AND** the `Manual open` action remains available

### Requirement: One manual-open entry for all connection types

The Start Center SHALL expose one `Manual open` action that opens the existing ConnectionDialog. ConnectionDialog SHALL remain the single place where Serial, RTT Log, SSH, and Local Shell are selected and configured.

#### Scenario: User wants a new connection

- **WHEN** the user clicks `Manual open`
- **THEN** the connection dialog opens with its connection-type selector
- **AND** no COM list is rendered on Start Center
- **AND** serial discovery is visible only inside the serial connection flow

### Requirement: Defer device discovery until it is requested

The ordinary Start Center startup path SHALL NOT subscribe to runtime readiness or enumerate serial ports. Readiness discovery MAY start after the user opens the Advanced devices disclosure, and serial discovery SHALL start when the ConnectionDialog's serial flow is mounted.

#### Scenario: App opens on the Start Center

- **WHEN** there are no active sessions and the user has not opened a connection flow or Advanced devices
- **THEN** no readiness subscription or serial-port enumeration is started
- **AND** the Start Center still renders saved connections and Manual open

#### Scenario: User enters a connection flow

- **WHEN** the user clicks Manual open and selects Serial
- **THEN** the existing serial picker discovers and displays the current ports inside ConnectionDialog

### Requirement: Explain MCP injection location

The advanced-device disclosure SHALL identify MCP/Agent integration and control-profile configuration in both supported locales.

#### Scenario: User expands advanced devices

- **WHEN** the disclosure is opened
- **THEN** the summary and actions explicitly mention MCP/Agent integration
- **AND** no new hardware side effect occurs
