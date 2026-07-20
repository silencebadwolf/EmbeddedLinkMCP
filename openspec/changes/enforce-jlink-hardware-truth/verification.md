# Verification: J-Link Hardware Truth

Date: 2026-07-20

## Fresh automated evidence

- `pnpm run ci:check`: PASS
  - ESLint: 0 errors
  - TypeScript + Vite production build: PASS
  - Vitest: 162 files passed; 1955 tests passed; 17 existing tests skipped
  - License validation: 19 runtime dependencies and 29 packages in the audited dev-tooling closure passed
- `pnpm exec openspec validate enforce-jlink-hardware-truth --strict --no-interactive`: PASS
- `git diff --check`: PASS; only line-ending normalization warnings were emitted

## Regression evidence

- Commander exit code 0 without positive target-access output is rejected.
- Positive SW-DP/core evidence is accepted by an injected process runner; generated scripts contain
  no flash, erase, reset, halt, run, GDB, or RTT command.
- Adapter connect/status revalidate target access and retire stale idle handles.
- Physical probe discovery remains `connected: false` and does not merge in-memory handles.
- Active GDB/RTT ownership blocks Commander revalidation with `PROBE_BUSY`.
- Main IPC, MCP workflow, and renderer tests preserve connection failure without projecting a
  connected chip or continuing to flash.
- Stage-only progress has no numeric fill; streamed Commander percentages remain visible without
  percentage-derived byte counts; verified and unverified completion wording are distinct.

## GitNexus / PDG / taint review

- Pre-refresh `detect_changes(scope=all)` reported HIGH because `probeConnect` intentionally reaches
  control-profile, control-workflow, and RTT target preparation flows. These are the expected
  integration surfaces and are covered by focused and full-suite tests.
- A fresh `analyze --pdg` completed with 39,221 nodes, 71,645 edges, and 300 flows.
- The long-running MCP process did not hot-reinitialize the replaced `.gitnexus/lbug` file, so
  `pdg_query` and `explain` returned `LadybugDB not initialized` rather than findings.
- Bounded, read-only Cypher queries against the same fresh index confirmed the `AbortSignal` CDG
  guard and the Commander result reaching both failure and positive-evidence checks.
- Bounded `TAINTED` and `TAINT_PATH` queries for `jlink-adapter.ts` and
  `segger-command-runner.ts` returned no persisted findings. This is not treated as proof of safety.

## Hardware side effects

No real J-Link executable or hardware operation was invoked during this change. In particular, no
real flash, erase, reset, halt, debug connection, RTT connection, or target connection was run.
All target-access and progress evidence was produced by injected test doubles.

## Repository state

No commit, push, or PR was created for this change.
