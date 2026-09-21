# Desktop / Web monorepo migration status

Started: 2026-09-21. Branch: `codex/desktop-web-monorepo`.

The accepted scope is recorded in [the migration plan](./desktop-web-refactor-plan.md).
This file records completed work and remaining acceptance checks; it does not imply
that the Web application is already available.

## P0 — Baseline

- Baseline commit: `3bdf9b9`.
- Package manager: pnpm 9.15.0, preserving the existing lockfile and dependency versions.
- Verification host: Windows x64, Node 22.23.2.
- `lint`: passed.
- `build`: passed. Existing renderer bundle-size advisory remains (870.13 kB JS before gzip).
- Tests: 167 files, 2020 tests. Initial sandbox run passed 2017 tests. The three
  remaining tests passed when their two files were rerun outside the sandbox
  (58/58): audit export needs its existing `C:\audit-test` fixture path, and SEGGER
  process-runner tests need to terminate their own child processes.
- `validate:licenses`: passed outside the sandbox (tsx needs OS user information).
  19 runtime dependencies and 29 packages in the audited development-tool closure.
- No hardware tests, firmware writes, external SSH sessions, or device connections were performed.
- GitNexus 1.6.12 restored the local index (44,500 nodes, 89,195 edges, 521 flows).
  Its FTS extension could not be downloaded; symbol impact and context queries work.
  Flow enumeration has an analyzer budget, so missing flows are not treated as proof
  of absence. Zero-caller results were supplemented with source-reference checks.

## P1 — Workspace and contracts

- Added `packages/contracts`, shared TypeScript configuration and workspace globs.
  The root remains the temporary desktop application until P3.
- Moved 14 shared modules without changing their function bodies or schema behavior.
  Explicit exports resolve to compiled ESM and declarations. Contracts have no Node
  ambient types and no Electron imports; Window augmentation and IPC channel names
  remain in the desktop compatibility layer.
- Added transport-independent ClientAPI / ClientResult type aliases. Existing names
  and `src/shared` imports remain compatible during the staged migration.
- Frozen offline installation passed. The lockfile only adds the internal link and
  a contracts importer reusing Zod 4.4.3; no external dependency versions changed.
- License checking now includes app/package runtime and optional dependencies,
  rejects missing workspace targets and conflicting dependency versions, and
  retains the existing audited development-tool closure checks.
- Quality gate passed: lint, build, 170 test files / 2026 tests, and licenses.
  The renderer JS and CSS hashes are identical to the P0 baseline.
- Added package-boundary checks and contract compatibility/browser-byte tests.
- Hidden Electron 42.4.0 smoke passed with an isolated temporary data directory:
  real main-side composition, preload, bundled React renderer and session-list IPC
  all worked together. No hardware session was opened.
- Refreshed the graph after migration and ran `detect_changes(scope=all)` against
  the staged checkout: 50 files / 807 indexed symbols, without partial/truncation
  flags. Files and symbols were reviewed against the intended contracts/config/
  license/test/doc scope. The tool's zero affected-flow count is not used to
  downgrade the pre-edit HIGH/CRITICAL call-graph risks.

### Impact analysis before P1 source changes

Repository/worktree: `C:\Users\13271\Desktop\123\link-mcp`; branch:
`codex/desktop-web-monorepo`; index commit: `3bdf9b9`.

| Target | Direct callers / importers | Risk and affected area |
| --- | --- | --- |
| shared types | 54 files | CRITICAL; sessions, transports, main and renderer |
| PreloadAPI | 35 references | CRITICAL; IPC, renderer, connection/session factories |
| normalizeJLinkTargetName | 9 callers | CRITICAL; 16 grouped process entries spanning control profiles, debug, RTT and J-Link |
| suggest / classify target helpers | 1–6 callers | CRITICAL; probe connection, workflow and target resolution |
| fingerprintDeviceCandidate | 2 callers | CRITICAL; readiness draft selection and stale-candidate checks |
| activity / readiness / errors | 15 / 17 / 21 files | HIGH; ledger, IPC, UI and MCP consumers |
| createAuditRecord | AuditStore.enqueue | HIGH; activity capture during runtime operation |
| serializeTranscriptEvent | onSessionEvent, serializeEvent | LOW; IPC and MCP byte serialization |
| validateLicenses | CLI main plus test fixtures | LOW; license gate |

All 17 moved named functions and affected files received upstream impact analysis.
`createManualSerialDraft` had no indexed production callers; text search confirmed
its compatibility re-export and test callers. `src/shared/index.ts` likewise had no
indexed callers and is retained unchanged. Full local analysis is in the ignored
`.linkterm/impact-p1.json`. HIGH/CRITICAL findings were reported before edits.

## Remaining phases

- P2: runtime and MCP packages with injected host services.
- P3: shared UI and migrated Electron host.
- P4: independently runnable Node server and Web client.
- P5: full feature parity within the accepted Web scope.
- P6: authentication, file boundaries, reconnect, lifecycle and resource ownership.
- P7: independent native dependency staging, distributions, CI and deployment documentation.
