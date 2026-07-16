## MODIFIED Requirements

### Requirement: AI operations execute automatically after validation

All AI-origin operations SHALL execute after their existing schema, runtime, resource,
precondition, and admission checks pass. No human grant, approval continuation, pause latch, or
`confirm=true` value SHALL be required to invoke the effectful backend.

#### Scenario: high-impact MCP operation

- **WHEN** an AI client calls a validated flash, reset, control-workflow, or runtime-control
  tool
- **THEN** LinkTerm invokes the existing handler/backend path immediately after admission
- **AND** Activity, transcript, and audit observations are emitted
- **AND** no approval request or continuation token is created.

#### Scenario: legacy confirm metadata

- **WHEN** an older client sends `confirm: false` or `confirm: true`
- **THEN** the value is ignored for authorization
- **AND** the operation follows the same automatic execution path.

### Requirement: Activity is observation-only

The Activity Center SHALL present execution progress, results, errors, and evidence references
without approve, deny, continue, or take-over actions. Legacy approval-shaped records SHALL be
rendered as automatic observation records.

#### Scenario: legacy activity record

- **WHEN** the renderer replays an event containing historical approval metadata
- **THEN** it displays `Auto-executed · observation only`
- **AND** it does not display a human approval or authorization status.

### Requirement: Existing trust and input boundaries remain authoritative

Observe-only execution SHALL NOT bypass `SessionManager`, `WriteQueue`, `Transport`,
`IJLinkBackend`, workflow managers, validation, cancellation, or redaction boundaries.

#### Scenario: human and AI share the existing write path

- **WHEN** a human terminal input and an AI write are submitted for the same session
- **THEN** both enter the existing WriteQueue and transcript path
- **AND** neither request is blocked by an approval or pause mechanism
- **AND** the established FIFO/high-priority semantics remain unchanged.
