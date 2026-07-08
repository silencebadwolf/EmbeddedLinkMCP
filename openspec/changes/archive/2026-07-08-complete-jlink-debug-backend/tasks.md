## 1. OpenSpec and reference analysis

- [x] 1.1 Create `complete-jlink-debug-backend` proposal, design, delta spec, and phased task list.
- [x] 1.2 Compare `Klievan/jlink-mcp` Commander, GDB server, register, memory, RTT, breakpoint, CPU control, snapshot, and crash diagnosis behavior in `design.md`.
- [x] 1.3 Run `openspec validate --all` after artifacts are written.

## 2. Phase A: CPU halt/run/step + status

- [x] 2.1 Add failing unit tests for production `JLinkAdapter.cpuHalt`, `cpuRun`, and `cpuStep` delegating to the Commander client.
- [x] 2.2 Add Commander client methods and command parsing needed for halt/run/step without spawning from MCP surface.
- [x] 2.3 Implement `JLinkAdapter` CPU halt/run/step using existing probe locking and error translation.
- [x] 2.4 Add or update MCP debug tests for CPU evidence/error behavior if backend evidence shape changes.
- [x] 2.5 Run targeted CPU/J-Link tests and update this checklist.

## 3. Phase B: Register read/list/write

- [x] 3.1 Add failing tests for register dump parsing and `JLinkAdapter.registerRead/registerList/registerWrite`.
- [x] 3.2 Implement Commander register read/list/write operations and safe register-name validation.
- [x] 3.3 Ensure MCP `register_read`, `register_list`, and `register_write` return structured debug evidence and translated errors.
- [x] 3.4 Run targeted register tests and update this checklist.

## 4. Phase C: Memory read/write

- [x] 4.1 Add failing tests for J-Link memory dump parsing into `Buffer` and memory write command construction.
- [x] 4.2 Implement bounded `memoryRead` and `memoryWrite` in the Commander client and adapter.
- [x] 4.3 Verify MCP `memory_read` base64 output and `memory_write` 16 MiB cap behavior remain intact.
- [x] 4.4 Run targeted memory and binary debug tests and update this checklist.

## 5. Phase D: Breakpoint set/clear/list

- [x] 5.1 Add failing tests for per-probe breakpoint ids, list behavior, clear known id, and clear unknown id.
- [x] 5.2 Implement Commander breakpoint set/clear command support and per-probe breakpoint ledger.
- [x] 5.3 Ensure `breakpoint_clear(id)` does not silently remove unrelated breakpoints if backend clear/reapply fails.
- [x] 5.4 Run targeted breakpoint tests and update this checklist.

## 6. Phase E: RTT connect/read/search/clear

- [x] 6.1 Add failing tests for backend-owned RTT client/session with injected fake transport.
- [x] 6.2 Implement RTT connection through GDB server RTT telnet or an equivalent backend-owned RTT abstraction.
- [x] 6.3 Implement bounded RTT buffer read, literal search without consuming, and clear/drain semantics.
- [x] 6.4 Verify RTT evidence stays `debug_output` and does not append terminal transcripts.
- [x] 6.5 Run targeted RTT tests and update this checklist.

## 7. Phase F: Snapshot and crash diagnosis

- [x] 7.1 Add failing tests for `snapshotCapture` reading registers plus requested memory ranges.
- [x] 7.2 Add failing tests for Cortex-M fault register decoding and unknown-fault degradation.
- [x] 7.3 Implement `snapshotCapture` and `crashDiagnose` through existing register/memory backend operations.
- [x] 7.4 Verify MCP `snapshot_capture` base64-encodes memory snippets and `crash_diagnose` returns structured diagnosis.
- [x] 7.5 Run targeted snapshot/crash tests and update this checklist.

## 8. Phase G: Flash erase/write boundary completion

- [x] 8.1 Add failing tests for production `flashErase` and `flashWrite` delegating to Commander client.
- [x] 8.2 Implement Commander erase and flash write operations while preserving explicit address requirements.
- [x] 8.3 Verify `flash_erase` and `flash_write` confirmation gates run before backend calls, and `flash_write` runs before base64 decode.
- [x] 8.4 Run targeted flash and high-impact confirmation tests and update this checklist.

## 9. Final verification and hardware evidence

- [x] 9.1 Run `pnpm test -- tests/unit/jlink tests/unit/mcp/debug`.
- [x] 9.2 Run `pnpm run build:main`, `pnpm run lint`, and `pnpm run validate:licenses`.
- [x] 9.3 Run `openspec validate --all`.
- [x] 9.4 If LinkTerm MCP hardware tools are available, perform staged real-hardware verification through LinkTerm MCP or HTTP runtime bridge only. (N/A: LinkTerm MCP J-Link tools are not exposed in this session; no CLI fallback used.)
- [x] 9.5 Update `DEVELOPMENT_PLAN.md` Phase 9 backlog/result notes after implementation is complete.
