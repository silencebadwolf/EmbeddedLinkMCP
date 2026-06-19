## ADDED Requirements

### Requirement: JLinkMCP reference usage is recorded as design-only
LinkTerm SHALL treat the no-license JLinkMCP repository as a design reference only and SHALL NOT copy or vendor its implementation.

#### Scenario: Developer uses reference observations
- **WHEN** a developer uses observations from JLinkMCP during LinkTerm MCP/J-Link work
- **THEN** the developer may reference high-level concepts such as transport selection, minimal MCP bootstrapping, SSE lifecycle, or backend-internal Commander orchestration
- **AND** the developer MUST NOT copy source code, scripts, file structure, handler logic, or raw output parsing from JLinkMCP

#### Scenario: Code review examines reference-derived change
- **WHEN** a LinkTerm change claims inspiration from JLinkMCP
- **THEN** reviewers verify that hardware operations still pass through LinkTerm MCP tools and `IJLinkBackend`
- **AND** reviewers verify that no hardcoded JLinkMCP target/interface/speed/temp-file/raw-output model was imported

### Requirement: Reference facts are not persisted into runtime configuration
LinkTerm SHALL NOT persist JLinkMCP sample hardware facts into LinkTerm workspace control profiles or runtime defaults.

#### Scenario: Control profile is generated
- **WHEN** LinkTerm creates or updates `.linkterm/control-profile.json`
- **THEN** it uses only user-provided, request-provided, workspace-derived, or hardware-observed non-sensitive facts
- **AND** it does not populate nRF52, SWD, 4000 kHz, fixed memory addresses, or script snippets solely because they appear in JLinkMCP
