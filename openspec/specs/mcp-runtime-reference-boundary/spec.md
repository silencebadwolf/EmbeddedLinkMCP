# mcp-runtime-reference-boundary Specification

## Purpose

Define the boundary that keeps packaged LinkTerm runtime behavior independent from source-reference repositories.
## Requirements
### Requirement: LinkTerm runtime does not depend on reference repository files
LinkTerm SHALL NOT require the local JLinkMCP reference repository or its `.understand-anything` graph at runtime.

#### Scenario: Packaged LinkTerm starts
- **WHEN** LinkTerm runs from a packaged build or a clean user workspace
- **THEN** MCP startup, status, runbook, debug, and workflow tools do not read `<reference-repos>/JLinkMCP`
- **AND** they do not depend on any reference-repository source file or generated graph

#### Scenario: Design documentation references graph
- **WHEN** developers review the OpenSpec proposal or design
- **THEN** they may use the reference graph as planning context
- **AND** runtime code does not embed or load that graph
