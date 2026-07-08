# Design

## Problem

The current RTT log session path proves that LinkTerm can open an App-visible transcript and poll RTT bytes, but it treats every device-origin byte as the same kind of evidence. Real SEGGER RTT output starts with backend banner lines such as `SEGGER J-Link` and `Real time terminal output`; those lines prove the transport path, not firmware logging.

When the transcript contains only those banner lines, LinkTerm should say so explicitly and expose a machine-readable classification. That prevents agents from turning a log-silence symptom into another flash/download attempt.

## Decisions

### Decision 1: classify from the shared transcript

Add a small core helper that accepts transcript events plus session metadata and returns:
- whether system open guidance was seen,
- whether SEGGER RTT transport banner bytes were seen,
- how many firmware-output bytes remain after banner-only lines are excluded,
- a stable classification and next actions.

This keeps MCP and App behavior aligned because both use the same transcript evidence.

### Decision 2: add a read-only MCP diagnostic tool

Expose `diagnose_rtt_log_session` with `sessionId`. The tool reads the existing session from `SessionManager`, verifies it is an `rtt-log` session, classifies the transcript, and returns structured `debug_output` evidence. It does not connect probes, start GDB, reset, halt, flash, or open sessions.

### Decision 3: annotate banner-only sessions in the App transcript

When an RTT log session polls device bytes that are recognized as SEGGER transport banner only, append a system-origin guidance line after the device event. This makes the diagnosis visible in the same tab the human sees, without requiring an AI-only tool call.

The annotation is guarded so it is emitted once per session and does not hide later firmware output.

## Risks

- Banner matching may miss a future SEGGER wording. Mitigation: unknown device bytes are treated as firmware output, so LinkTerm errs toward not falsely claiming silence.
- `RttLogSession` is shared by IPC and MCP flows. Mitigation: do not alter its public lifecycle or read/write contract; only append an extra system transcript event and add tests around existing behavior.
