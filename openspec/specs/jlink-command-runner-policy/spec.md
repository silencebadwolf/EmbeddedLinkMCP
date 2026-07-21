# jlink-command-runner-policy Specification

## Purpose

Define how LinkTerm resolves, invokes, bounds, classifies, and redacts SEGGER Commander and GDB server process execution.
## Requirements
### Requirement: SEGGER process execution is backend-owned
LinkTerm SHALL keep all SEGGER Commander and GDB server process execution inside the `src/jlink/` backend, client, and runner layer.

#### Scenario: MCP surface needs a SEGGER operation
- **WHEN** a MCP debug or control-workflow tool requires a SEGGER Commander or GDB server operation
- **THEN** it delegates through `IJLinkBackend`
- **AND** only the backend-owned runner layer may start the external process

#### Scenario: Non-backend code attempts direct execution
- **WHEN** implementation code outside `src/jlink/` would need to run `JLink.exe`, `JLinkExe`, `JLinkGDBServerCL.exe`, GDB, or a flash CLI
- **THEN** the implementation MUST introduce or reuse a backend abstraction instead
- **AND** it MUST NOT add direct process execution at that call site

### Requirement: Trusted executable resolution
LinkTerm SHALL execute SEGGER tools only through trusted absolute executable paths resolved by the backend runner policy.

#### Scenario: Absolute executable path is configured and exists
- **WHEN** the backend runner is configured with an existing absolute SEGGER executable path
- **THEN** the runner may use that path with shell execution disabled

#### Scenario: Relative or bare executable path is configured
- **WHEN** the backend runner is configured with `JLink.exe`, `JLinkExe`, `JLinkGDBServerCL.exe`, or any relative path
- **THEN** the runner rejects the request before spawning a process
- **AND** it returns a J-Link domain error suitable for MCP translation

#### Scenario: Executable cannot be resolved
- **WHEN** no trusted executable path is available
- **THEN** LinkTerm returns a structured backend failure
- **AND** it does not fall back to PATH lookup, current-directory lookup, VS Code tasks, or shell scripts

### Requirement: Commander scripts and process arguments are generated safely
LinkTerm SHALL generate Commander scripts, command files, and process arguments from structured backend requests without shell interpolation or shared temporary filenames.

#### Scenario: Commander script is needed
- **WHEN** a backend operation needs a temporary Commander script
- **THEN** LinkTerm creates a unique temporary file under a controlled temp root
- **AND** it deletes the temporary file after execution or failure when possible
- **AND** concurrent operations cannot overwrite each other's scripts

#### Scenario: Process is spawned
- **WHEN** LinkTerm starts a SEGGER process
- **THEN** it passes command and arguments as an argument vector
- **AND** it disables shell execution
- **AND** it bounds stdout and stderr capture

### Requirement: SEGGER output is bounded, classified, and redacted
LinkTerm SHALL bound SEGGER output capture and redact sensitive probe identifiers before evidence or error details cross the backend boundary.

#### Scenario: SEGGER command fails
- **WHEN** a SEGGER command exits with failure or emits a known fatal marker
- **THEN** LinkTerm classifies the failure as a J-Link domain error
- **AND** it includes only bounded, redacted output preview in diagnostics
- **AND** it does not expose probe serial numbers as MCP evidence

#### Scenario: SEGGER command succeeds with noisy output
- **WHEN** a SEGGER command succeeds but emits banners or benign text
- **THEN** LinkTerm returns structured backend DTOs where available
- **AND** MCP evidence does not require the AI client to parse raw SEGGER text to determine success

### Requirement: No-license reference repository remains design-only
LinkTerm SHALL treat the JLinkMCP reference repository as design-only input unless a future license review explicitly permits code reuse.

#### Scenario: Implementation references JLinkMCP
- **WHEN** an implementation task uses observations from JLinkMCP
- **THEN** the resulting code MUST NOT copy source text, function bodies, file structure, temporary script content, or raw output handling from JLinkMCP
- **AND** the implementation MUST preserve LinkTerm's backend boundary, structured evidence, validation, and automatic-execution policy

#### Scenario: Runtime dependency review runs
- **WHEN** license validation is executed
- **THEN** JLinkMCP is not treated as a vendored dependency
- **AND** no new runtime dependency is introduced for that no-license source
