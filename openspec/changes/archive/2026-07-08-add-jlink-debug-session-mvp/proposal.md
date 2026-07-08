## Why

LinkTerm's current J-Link path can flash raw binaries, but AI agents still fall back to low-level probing when they need an interactive debug session, RTT evidence, or target attach diagnosis. A compact debug-session MVP should make the recommended path explicit and deterministic, mirroring the smooth workflow observed in `Klievan/jlink-mcp` while preserving LinkTerm's stronger safety and evidence boundaries.

## What Changes

- Add a J-Link debug-session capability that starts and tracks a controlled GDB server process through LinkTerm's J-Link backend.
- Add structured preflight for GDB server availability, target support, port binding, and process lifecycle failures before agents enter repeated low-level retries.
- Add a high-level `start_debug_session`-style workflow step inside `run_control_workflow` for debug-diagnose use cases.
- Add minimal CPU/register/memory diagnostic support needed for `snapshot` and debug-session verification where possible, with unsupported subfeatures returning structured `NOT_IMPLEMENTED` next actions.
- Keep all SEGGER CLI execution inside `src/jlink/`; MCP, IPC, renderer, and tests must not invoke J-Link/GDB CLIs directly.
- Preserve high-impact confirmation gates for operations that reset, flash, erase, or start externally visible debug services.

## Capabilities

### New Capabilities
- `jlink-debug-session`: LinkTerm-managed J-Link GDB server lifecycle, target preflight, debug-session evidence, and deterministic recovery guidance for AI agents.

### Modified Capabilities
- `workspace-control-profile`: Extend workflow behavior to reuse workspace J-Link profile fields for debug-session startup and structured blockers.

## Impact

- Affected code: `src/jlink/`, `src/mcp/surfaces/debug/`, `src/mcp/surfaces/control-workflow/`, related tests under `tests/unit/jlink/`, `tests/unit/mcp/`, and integration coverage where applicable.
- APIs: Existing MCP debug tools remain stable; `gdb_server_start` becomes backed by a real LinkTerm-managed process where SEGGER GDB server is available. `run_control_workflow` gains a deterministic debug-session path for `debug-diagnose`.
- Dependencies: No new runtime dependencies are expected. Uses Node child process primitives already present in the J-Link adapter layer.
- Systems: Improves AI hardware-control behavior without weakening LinkTerm's ownership boundary, confirmation gates, or evidence separation.
