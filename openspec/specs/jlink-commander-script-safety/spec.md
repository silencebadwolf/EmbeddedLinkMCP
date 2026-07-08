# jlink-commander-script-safety Specification

## Purpose

Define safe generation, isolation, and cleanup requirements for backend-owned J-Link Commander scripts.
## Requirements
### Requirement: Commander script content is generated from LinkTerm operations
LinkTerm SHALL generate Commander script content from explicit LinkTerm backend operations and validated parameters rather than copying reference-repository script snippets.

#### Scenario: Reset script is generated
- **WHEN** backend code needs a Commander reset sequence
- **THEN** the sequence is generated from LinkTerm's reset operation semantics and validated probe context
- **AND** it does not include unrelated sample memory reads copied from references

#### Scenario: Flash or memory script is generated
- **WHEN** backend code needs a Commander flash or memory sequence
- **THEN** addresses, lengths, binary paths, and verify behavior come from validated request/profile facts
- **AND** the script generation rejects missing or invalid values before spawning a process
