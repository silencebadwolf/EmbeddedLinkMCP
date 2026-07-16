# Design: observe-only AI execution

## Execution boundary

MCP state-affecting tools continue through `OperationAdmissionCoordinator` for revalidation,
serialization, and lease bookkeeping. The coordinator does not ask for a grant and does not
consult a pause latch. Direct Control Profile RUN/START paths use the same admission boundary.
The effectful handler remains behind the existing SessionManager, WriteQueue, Transport,
IJLinkBackend, and workflow manager seams.

## Observation boundary

`OperationRecorder`/`OperationLedger` and the durable audit store remain best-effort observation
channels. They receive redacted metadata and evidence references only. Renderer projections may
retain legacy approval fields for replay compatibility, but the Activity Center always displays
automatic execution and never offers approve/deny/continue actions.

## Compatibility

Existing `confirm` fields are accepted where already present so older MCP clients do not fail
schema validation; the value is ignored. No `approval:*` IPC channel or preload namespace is
exposed. Historical audit/activity records are readable but cannot reactivate approval or pause
behavior.

## Human input

Human terminal writes and AI writes continue to converge at the existing WriteQueue. Normal
writes are FIFO; the established high-priority lane remains reserved for explicit human abort/
interrupt input. No new origin-based mutex or pause gate is introduced.
