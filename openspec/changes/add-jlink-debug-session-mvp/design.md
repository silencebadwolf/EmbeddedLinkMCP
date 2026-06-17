## Context

LinkTerm already exposes a J-Link debug surface with 28 registered tools, a real `JLinkAdapter` lifecycle shell, raw binary `flashDownload`/`flashVerify`, high-impact confirm gates, and `run_control_workflow` for flash/serial observation. The remaining friction is that AI agents do not yet have a durable debug session primitive: most CPU, GDB, RTT, snapshot, and recovery methods still return `NOT_IMPLEMENTED`, so agents can fall back to low-level tool loops when they need live debug evidence.

The external `Klievan/jlink-mcp` repository is smooth because it wraps the debug path in a probe state machine, a long-lived GDB server, RTT buffering, concise output formatting, and composite tools such as `start_debug_session`, `snapshot`, and `diagnose_crash`. LinkTerm should borrow the architecture pattern, not source code, and keep stronger product constraints: all external SEGGER/GDB execution stays inside `src/jlink/`, high-impact gates stay enforced, and MCP returns structured evidence rather than raw text-only responses.

## Goals / Non-Goals

**Goals:**
- Provide a LinkTerm-managed J-Link debug-session MVP that starts/stops a SEGGER GDB server through the backend, tracks the server handle, captures bounded process output, and returns structured status.
- Make `run_control_workflow` able to prepare a debug session for `debug-diagnose` without flashing or reset unless explicitly requested.
- Reuse the existing workspace control profile for target/interface/speed and reuse existing schema-version/confirmation/error translation rules.
- Add deterministic blockers for missing Commander/GDB server executable, unsupported target, bind timeout, and process failures.
- Keep tests hardware-free by using process-runner fakes and `FakeJLinkBackend`.

**Non-Goals:**
- Full source-level GDB client support (`arm-none-eabi-gdb` MI bridge) is out of scope for this MVP.
- Full RTT streaming/search through J-Link GDB server telnet is out of scope for the first slice, but the design leaves an explicit extension point.
- Copying code from `Klievan/jlink-mcp` is out of scope; this change only mirrors proven concepts.
- Changing the existing MCP tool names or breaking clients is out of scope.

## Decisions

### Decision 1: Extend the SEGGER runner layer instead of adding a new CLI path

`segger-command-runner.ts` already provides the trusted path resolver, bounded child-process execution, timeout handling, and Commander target support preflight. The MVP will extend this layer with a GDB-server-specific client/runner path rather than letting MCP tools spawn `JLinkGDBServerCL.exe` directly.

Rationale: this preserves the existing security boundary and testability contract. The alternative—spawning from `src/mcp/surfaces/debug`—would violate the project rule that MCP handlers never touch external J-Link/GDB CLIs.

### Decision 2: Track GDB server state per probe handle inside `JLinkAdapter`

`JLinkAdapter` already mints `probeId` handles and serializes physical probe operations with `probeKey`. The MVP will add per-handle GDB server state (`host`, `port`, process handle/status/output tail) and make `gdbServerStart` idempotent for an already-running handle with the same endpoint. `gdbServerStop` will terminate and clear that state.

Rationale: this keeps backend state co-located with probe lifecycle and lets `probeDisconnect` reject or cleanly handle busy server state. The alternative—a separate MCP-side registry—would split ownership and make cleanup on disconnect/app shutdown harder.

### Decision 3: Use process-output readiness instead of fixed sleeps where possible

The MVP will consider the GDB server ready when captured output indicates the configured port is listening, with a bounded timeout and fallback failure details. It will retain output preview after timeout/failure with serial numbers redacted.

Rationale: fixed sleeps caused wasted time and unclear failures. Readiness detection creates deterministic evidence. The fallback remains safe because SEGGER output formats vary by version.

### Decision 4: `run_control_workflow(debug-diagnose)` starts a debug session before diagnosis

For `mode='debug-diagnose'`, after profile preflight and probe connection, the workflow will call `gdbServerStart` before register/memory diagnosis when debug evidence is requested. If the backend returns `NOT_IMPLEMENTED`, the workflow records a skipped `gdb_server_start` step and continues with whatever diagnostics are available.

Rationale: this gives agents one stable high-level path. The alternative—requiring agents to call `gdb_server_start` manually before `run_control_workflow`—keeps the exact low-level sequencing problem we are trying to remove.

### Decision 5: Keep reset/flash confirmation semantics unchanged

Starting a local-only GDB server is already a high-impact debug operation in the existing tool schema and keeps its `confirm=true` gate. `run_control_workflow` will require confirmation when it needs to start a debug server, reset, flash, erase, or halt-on-failure.

Rationale: LinkTerm's safety model is more conservative than `jlink-mcp` and should remain that way.

## Risks / Trade-offs

- **SEGGER output varies by version** → Readiness detection will match multiple common port/listening phrases and still fail with a bounded output preview if no match is seen.
- **Port conflicts** → The backend will return `JLINK_OPERATION_FAILED` or `ABORTED` with a structured message and `nextActions` rather than retrying arbitrary ports.
- **Long-lived process cleanup** → `JLinkAdapter.dispose` does not currently exist in `IJLinkBackend`; MVP cleanup will be tied to `gdbServerStop`, `probeDisconnect`, and process-runner termination paths. Follow-up can add backend lifecycle disposal if needed.
- **RTT still incomplete** → Starting GDB server prepares RTT telnet, but RTT buffer/search is deferred. `run_control_workflow` will report RTT as skipped/not implemented rather than pretending to observe RTT.
- **Target support package missing** → Existing target database preflight remains the first blocker; debug session should not spawn GDB server for an unsupported target.

## Migration Plan

1. Add GDB server process client abstractions under `src/jlink/` and unit tests with fake process runners.
2. Extend `JLinkAdapter.gdbServerStart/Stop` to use the new client and existing probe locks.
3. Extend `run_control_workflow` to add a `gdb_server_start` step for debug-session preparation.
4. Add MCP/control-workflow tests proving high-level debug-diagnose no longer returns raw `NOT_IMPLEMENTED` when the fake backend supports GDB start.
5. Run targeted tests, main build, lint, and full test suite if practical.

Rollback is local and reversible: revert the new J-Link client and workflow step while leaving existing flash/serial behavior unchanged.

## Open Questions

- Should a future follow-up expose an explicit `start_debug_session` MCP tool name, or should `run_control_workflow(mode='debug-diagnose')` remain the single high-level entry point?
- Should LinkTerm later own a persistent GDB/MI client, or should it expose only GDB server lifecycle and let external IDEs attach?
