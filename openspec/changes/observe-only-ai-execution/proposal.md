# Observe-only AI execution

## Why

The product owner explicitly chose shared human/AI operation with no approval workflow.
AI actions, including flash, reset, and control workflows, must proceed automatically after
normal validation. The operator needs a trustworthy view of what happened, not a second
approval task or a pause/take-over control.

## What changes

- Remove approval as a runtime decision, IPC namespace, preload capability, or continuation.
- Treat `confirm` inputs as deprecated caller metadata only; they never gate execution.
- Keep Main admission serialization, SessionManager, WriteQueue, Transport, IJLinkBackend,
  Activity Center, transcript, and durable audit boundaries intact.
- Render all activity authorization metadata as `Auto-executed · observation only`, including
  legacy records that still carry approval-shaped fields.
- Preserve ordinary validation, runtime freshness checks, backpressure, cancellation, and
  hardware safety checks. This change does not authorize real hardware side effects during
  tests.

## Scope

In scope: approval removal and observe-only projections across MCP, Main IPC/preload, renderer,
runbook, tests, and documentation.

Out of scope: new hardware workflows, cloud services, telemetry, databases, transcript
redaction policy changes, or changes to the existing human/AI WriteQueue ordering.
