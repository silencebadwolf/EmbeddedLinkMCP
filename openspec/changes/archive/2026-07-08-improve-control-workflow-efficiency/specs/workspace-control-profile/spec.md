## MODIFIED Requirements

### Requirement: J-Link auto speed fallback

LinkTerm SHALL support `jlink.speedKHz` as either a positive numeric kHz value or the literal `auto`. For high-level raw flash workflows, LinkTerm SHALL interpret `auto` as a safe flash speed policy rather than delegating initial speed selection to SEGGER auto.

#### Scenario: Numeric speed is used directly
- **WHEN** `jlink.speedKHz` is `4000`
- **THEN** MCP passes `4000` kHz to the J-Link backend

#### Scenario: Auto speed uses safe flash speed for raw flash workflow
- **WHEN** `jlink.speedKHz` is `auto`
- **AND** `run_control_workflow` performs a raw binary flash operation
- **THEN** LinkTerm passes a safe flash speed to the J-Link backend
- **AND** the workflow evidence reports that `auto` was resolved by the high-level safe speed policy

#### Scenario: Auto speed remains valid in the profile
- **WHEN** a control profile stores `jlink.speedKHz` as `auto`
- **THEN** the profile remains valid
- **AND** LinkTerm does not require the user to rewrite the profile to a numeric speed before running a high-level workflow
