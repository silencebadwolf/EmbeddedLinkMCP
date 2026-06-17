## 1. J-Link GDB server backend

- [x] 1.1 Add trusted SEGGER GDB server executable resolution and availability checks in `src/jlink/` without PATH/current-directory fallback.
- [x] 1.2 Add a bounded process runner/client for `JLinkGDBServerCL.exe` with readiness detection, timeout termination, output tail capture, and serial-number redaction.
- [x] 1.3 Extend `JLinkAdapter` probe handles to track GDB server state and implement `gdbServerStart` / `gdbServerStop` using the backend-owned client.
- [x] 1.4 Ensure probe disconnect and repeated GDB start/stop calls behave deterministically and do not leak child processes.

## 2. High-level workflow integration

- [x] 2.1 Extend `run_control_workflow` preflight so debug-diagnose checks target support and GDB server availability before process spawn.
- [x] 2.2 Add a `gdb_server_start` workflow step for `debug-diagnose`, with deterministic `skipped` behavior on `NOT_IMPLEMENTED`.
- [x] 2.3 Add structured blockers and `nextActions` for missing executable, unsupported target, bind timeout, and backend-not-implemented cases.
- [x] 2.4 Preserve existing flash/observe behavior and high-impact confirmation semantics.

## 3. Tests and verification

- [x] 3.1 Add unit tests for GDB server path resolution, process args, readiness detection, timeout output preview, and cleanup.
- [x] 3.2 Add `JLinkAdapter` tests for GDB server lifecycle, idempotent start, stop, and disconnect cleanup.
- [x] 3.3 Add MCP/control-workflow tests proving debug-diagnose starts or skips GDB server predictably and never falls into low-level retries.
- [x] 3.4 Run targeted tests, `pnpm run build:main`, `pnpm run lint`, and `openspec validate --all`.
