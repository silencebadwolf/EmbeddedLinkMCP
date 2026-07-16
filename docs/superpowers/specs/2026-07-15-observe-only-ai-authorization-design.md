# Observe-only authorization

## Goal

LinkTerm executes every AI and human operation immediately. The user observes execution through the terminal, Activity Center, transcript, and durable audit; no approval or continuation step is required.

## Boundaries

- Remove approval-required decisions and approval continuation from MCP and Main control-profile paths.
- Keep Main-owned admission serialization, SessionManager, WriteQueue, Transport, and IJLinkBackend boundaries.
- Keep origin/principal/effect metadata, Activity, transcript, and durable audit projections.
- Keep validation and operational failures; only human authorization gating is removed.
- Do not perform real hardware actions during implementation or tests.

## Acceptance

An AI call to any formerly approval-gated operation reaches its effectful handler in the same invocation and never returns `APPROVAL_REQUIRED`. Existing activity/audit records show the operation and its origin, and all non-authorization errors remain unchanged.
