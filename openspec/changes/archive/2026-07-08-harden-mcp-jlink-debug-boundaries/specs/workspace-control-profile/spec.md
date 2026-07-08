## ADDED Requirements

### Requirement: Profile-backed J-Link parameter provenance
LinkTerm SHALL derive J-Link target, interface, speed, flash binary, flash base address, verify behavior, RTT configuration, and serial terminal facts from the workspace control profile, the current MCP request, or explicit user-confirmed input.

#### Scenario: Profile provides J-Link facts
- **WHEN** a control workflow or debug activation uses a workspace control profile with J-Link configuration
- **THEN** LinkTerm uses the profile target, interface, and speed values for backend operations
- **AND** evidence or diagnostics can distinguish profile-derived values from request-provided values where relevant

#### Scenario: Request overrides an allowed value
- **WHEN** a MCP request supplies an allowed operation-specific override such as firmware path or flash base address
- **THEN** LinkTerm validates that value at the MCP boundary
- **AND** the operation evidence identifies that the value came from the request rather than an implicit reference default

#### Scenario: Required hardware facts are missing
- **WHEN** a workflow or debug operation lacks required target, interface, speed, firmware, base address, or RTT facts
- **THEN** LinkTerm returns a structured missing-configuration response or control-profile question
- **AND** it does not guess facts from JLinkMCP examples, README snippets, SEGGER defaults, or previous unrelated sessions

### Requirement: Reference repository defaults are not runtime defaults
LinkTerm SHALL NOT use JLinkMCP reference-repository example values as runtime defaults for target hardware operations.

#### Scenario: No target is configured
- **WHEN** no target device is present in the control profile or current request
- **THEN** LinkTerm does not default to nRF52 or any other reference-repository target
- **AND** it asks for configuration or returns a structured error before backend execution

#### Scenario: No interface or speed is configured
- **WHEN** interface or speed is missing
- **THEN** LinkTerm uses only LinkTerm-defined safe defaults or asks for confirmation according to the workflow policy
- **AND** it does not silently apply reference-repository SWD or 4000 kHz values

### Requirement: Profile-derived high-impact workflows preserve confirmation
LinkTerm SHALL preserve high-impact confirmation even when all parameters come from a complete workspace control profile.

#### Scenario: Complete profile is used for flash workflow
- **WHEN** a profile contains target, interface, speed, firmware path, flash base address, and verify settings
- **THEN** high-impact flash workflow modes still require confirmation
- **AND** missing confirmation returns `CONFIRMATION_REQUIRED` before firmware loading, payload decoding, or backend execution

#### Scenario: Complete profile is used for reset or GDB server start
- **WHEN** a profile contains enough J-Link facts to reset the target or start a GDB server
- **THEN** `cpu_reset` and `gdb_server_start` still require confirmation
- **AND** missing confirmation prevents backend invocation
