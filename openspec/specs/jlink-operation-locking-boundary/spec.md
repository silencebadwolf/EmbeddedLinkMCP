# jlink-operation-locking-boundary Specification

## Purpose

Define probe-level serialization requirements that keep concurrent J-Link operations deterministic and safe.
## Requirements
### Requirement: J-Link operations preserve probe-level serialization
LinkTerm SHALL preserve per-probe or physical-probe serialization for operations that can conflict on the same target.

#### Scenario: Concurrent operations target same connected probe
- **WHEN** two state-affecting backend operations target the same `probeId`
- **THEN** LinkTerm serializes or rejects the conflicting operation with a structured busy error
- **AND** it does not run overlapping SEGGER commands against the same probe

#### Scenario: Probe identity includes physical serial number internally
- **WHEN** backend code uses physical probe identity for locking
- **THEN** it may use serial number internally where available
- **AND** MCP evidence still strips serial numbers before returning to AI clients
