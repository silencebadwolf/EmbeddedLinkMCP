## ADDED Requirements

### Requirement: Runtime status exposes MCP identity and transport diagnostics
LinkTerm SHALL expose read-only MCP runtime status containing process identity, transport mode, runtime metadata availability, metadata freshness, and schema version without mutating terminal, UI, workspace, or hardware state.

#### Scenario: Client performs startup health check
- **WHEN** an MCP client calls the startup status tool after connecting to LinkTerm
- **THEN** the result includes runtime identity with `runtimeId`, `pid`, and `startedAt`
- **AND** the result includes transport mode such as owner, proxy, stdio, or not-started
- **AND** the result includes the current LinkTerm MCP schema version

#### Scenario: Runtime metadata is available
- **WHEN** the runtime has owner metadata for the local HTTP bridge
- **THEN** the status evidence includes metadata availability, URL, path, freshness, and age when known
- **AND** it does not expose authentication tokens, credentials, private keys, or probe serial numbers

#### Scenario: Startup status is read-only
- **WHEN** startup status is requested
- **THEN** LinkTerm SHALL NOT open sessions, write terminal input, capture screenshots, connect probes, reset or halt CPUs, start GDB servers, flash firmware, erase flash, or write workspace files

### Requirement: Core MCP tool-set diagnostics
LinkTerm SHALL report deterministic diagnostics for the core MCP tool set expected in a fully capable runtime.

#### Scenario: Fully capable runtime reports complete core tools
- **WHEN** all core terminal, profile, workflow, runbook/status, debug, and UI tools are registered
- **THEN** status evidence includes a tool-set count
- **AND** status evidence includes a deterministic hash over registered tool names
- **AND** status evidence marks the core tool set as complete
- **AND** the missing core tool list is empty

#### Scenario: Runtime is missing a core tool
- **WHEN** a core tool is not registered in the current runtime
- **THEN** status evidence marks the core tool set as incomplete
- **AND** status evidence identifies the missing core tool names
- **AND** LinkTerm does not instruct the AI client to use direct J-Link, GDB, serial CLI, flash CLI, or VS Code tasks as a fallback

### Requirement: Tool registration diagnostics are generated from registry state
LinkTerm SHALL build tool-set diagnostics from the actual tools registered through the MCP registry, not from README text, source comments, or AI-side assumptions.

#### Scenario: Tool diagnostics are requested
- **WHEN** LinkTerm returns tool-set diagnostics
- **THEN** the registered tool list used for count and hash comes from the runtime registry
- **AND** duplicate tool names are normalized before hashing
- **AND** tool names are sorted deterministically before hashing

#### Scenario: New core tool is added
- **WHEN** a future change adds a tool that must exist in every fully capable runtime
- **THEN** the expected core tool list and diagnostics tests MUST be updated in the same change
