## ADDED Requirements

### Requirement: RTT control block address can be persisted in control profiles

LinkTerm SHALL allow workspace control profiles to persist an optional RTT control block address for deterministic J-Link RTT attachment.

#### Scenario: Hex RTT control block address is accepted

- **WHEN** a caller saves a control profile with `rtt.enabled=true` and `rtt.controlBlockAddress="0x24005310"`
- **THEN** LinkTerm SHALL accept and persist the address unchanged
- **AND** the saved profile SHALL remain schema version `linkterm-control/1.0.0`

#### Scenario: Decimal RTT control block address is rejected

- **WHEN** a caller saves a control profile with `rtt.controlBlockAddress="604001040"`
- **THEN** LinkTerm SHALL reject the profile
- **AND** it SHALL NOT silently convert the decimal value

#### Scenario: RTT address round-trips through the App panel

- **GIVEN** a saved control profile record has `rtt.controlBlockAddress="0x24005310"`
- **WHEN** a user opens that saved profile in the App control profile panel
- **THEN** the RTT control block address field SHALL show `0x24005310`

#### Scenario: RTT control block answer does not alter flash base

- **WHEN** a caller answers a control-profile prompt with `RTT 日志，_SEGGER_RTT=0x24005310` or `_SEGGER_RTT=0x24005310`
- **THEN** LinkTerm SHALL parse `0x24005310` as `rtt.controlBlockAddress`
- **AND** it SHALL NOT write or overwrite `flash.baseAddress`

#### Scenario: RTT control block answer preserves existing profile facts

- **GIVEN** an existing control profile has `jlink` and `flash` sections
- **WHEN** a caller applies an answer containing only `RTT 日志，_SEGGER_RTT=0x24005310`
- **THEN** LinkTerm SHALL preserve the existing `jlink` and `flash` sections
- **AND** it SHALL set `rtt.controlBlockAddress="0x24005310"`
- **AND** it SHALL remove any prior enabled serial observation section so the profile still has exactly one observation channel

### Requirement: Profile-based RTT open uses the configured control block address

When a profile-based RTT log session is opened and the profile has `rtt.controlBlockAddress`, LinkTerm SHALL pass that address to the J-Link RTT connection.

#### Scenario: MCP opens RTT log with configured control block

- **GIVEN** a workspace profile has `jlink.enabled=true`, `rtt.enabled=true`, and `rtt.controlBlockAddress="0x24005310"`
- **WHEN** `open_rtt_log_session` is called with that workspace `root`
- **THEN** LinkTerm SHALL call the J-Link backend RTT connect operation with `controlBlockAddress=0x24005310`
- **AND** the App-visible RTT log session SHALL use the selected RTT up channel from that connection

#### Scenario: Profile omits RTT control block

- **GIVEN** a workspace profile has `rtt.enabled=true` but no `rtt.controlBlockAddress`
- **WHEN** profile-based RTT log open prepares the J-Link backend
- **THEN** LinkTerm SHALL preserve the existing auto-discovery behavior
- **AND** it SHALL NOT invent or guess an address
