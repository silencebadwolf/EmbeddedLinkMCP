# transport-runtime-diagnostics Specification

## Purpose

Define runtime diagnostics that distinguish owner, proxy, stdio, and metadata states for AI startup health checks.
## Requirements
### Requirement: Runtime diagnostics distinguish owner, proxy, and stdio contexts
LinkTerm SHALL expose enough runtime diagnostics for an AI client to understand whether it is connected to the owner runtime, a stdio proxy, or a standalone stdio context.

#### Scenario: Connected through owner runtime
- **WHEN** LinkTerm MCP runs inside the Electron owner runtime
- **THEN** runtime diagnostics identify the owner transport context
- **AND** metadata fields indicate whether the local HTTP bridge metadata is available and fresh

#### Scenario: Connected through stdio proxy
- **WHEN** an MCP host connects through the LinkTerm stdio proxy
- **THEN** runtime diagnostics identify proxy transport context when available
- **AND** status evidence still reports the owner metadata target used by the proxy without exposing secrets

#### Scenario: Metadata is stale or unavailable
- **WHEN** runtime metadata is missing or stale
- **THEN** status evidence marks metadata as unavailable or not fresh
- **AND** recommended next actions point to restarting or repairing LinkTerm runtime ownership rather than using external hardware tools
