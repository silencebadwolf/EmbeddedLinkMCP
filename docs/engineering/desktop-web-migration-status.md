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

## P2 — Runtime and MCP separation (in progress)

- Moved workflow execution, background job management, firmware checks and shared
  operation errors out of the MCP layer. Compatibility exports preserve error
  identity and existing callers. Core / transport / J-Link modules no longer
  import MCP modules; an architecture test enforces this boundary.
- Checked 92 targets before this extraction: 21 CRITICAL, 40 HIGH, 6 MEDIUM and
  25 LOW, with no unknown or partial results. `ToolError` has 72 direct references;
  `runControlWorkflow` is called by desktop control-profile IPC and MCP workflow
  tools. HIGH/CRITICAL risks were reported before editing.
- Full quality gate passed: 171 test files / 2027 tests, build and licenses.
  Renderer JS and CSS hashes remain identical to the baseline.
- Migrated 150 backend modules into `packages/runtime` and `packages/mcp`, with
  explicit compiled ESM / declaration exports, workspace dependencies and TypeScript
  references. Relocated 85 unit test files into their owning packages. Root tests
  retain desktop adapters and cross-package integration checks.
- Added `createRuntime` with injected data directory, credential codec, native
  serial / PTY bindings, agent statuses and runtime diagnostics. Runtime no longer
  imports Electron, MCP or native serial / PTY packages. The desktop host supplies
  these factories; physical native installation isolation remains a P7 task.
- Desktop IPC and its direct / HTTP MCP adapters now receive the same runtime.
  Initialization failure rolls back registered handlers, protocol endpoints and
  runtime resources. Disposal is idempotent, rejects new sessions / jobs, waits
  for in-flight session opens and job cancellation, then releases sessions,
  managed RTT / GDB resources and audit storage.
- Preserved legacy desktop MCP executable entry paths and error object identity.
  The standalone stdio composition remains in the temporary desktop host until
  the independent Node host is introduced.
- Added compiled-export boundary tests, Node runtime lifecycle failure injection,
  and a two-client MCP integration test proving shared native factories, sessions,
  write queues, jobs, activity capture and all 63 existing tools.
- Full quality gate passed: 174 test files / 2034 tests, lint, build and licenses.
  Hidden Electron startup with an isolated profile passed after migration. Renderer
  JS and CSS hashes still match the baseline. All application / package build outputs
  were then removed and rebuilt from source; hidden Electron startup passed again.
- Pre-move impact calls covered 973 file / function / class targets, plus specific
  modified session and workflow methods. This index produced anomalous call edges
  and UNKNOWN results; those outputs were not treated as reliable exact caller
  counts. An AST reference inventory supplemented every target, including executable
  entries, unused compatibility exports and Vitest-discovered files. Confirmed
  production edges include main -> `registerIpcHandlers`; desktop session-open and
  MCP terminal / control-profile tools -> `buildSession`; and desktop / HTTP / stdio
  composition -> `createMcpServer`. HIGH / CRITICAL findings were reported. A full
  index rebuild replaces the incremental index before the next phase.
- Full graph rebuild completed and restored plausible direct caller edges (desktop
  composition -> runtime factory). Pre-commit `detect_changes(scope=all)` covered
  303 files / 261 changed symbols / 58 affected flows without truncation; changed
  files and flow names match runtime composition, session / job lifecycle, workflow
  errors, MCP callers and their tests. Comparison with `main` reports 347 files /
  1066 symbols / 58 flows; its symbol list is capped at 1000, so both phase-local
  reports and the complete Git file diff were used for cumulative scope review.
- Remaining shared service extraction: control-profile, connection, audit/export,
  readiness subscription and related UI orchestration still live in desktop IPC.
  These must move behind runtime services before Web feature parity is complete.

## Remaining phases

- P2: runtime and MCP packages with injected host services.
- P3: shared UI and migrated Electron host.
- P4: independently runnable Node server and Web client.
- P5: full feature parity within the accepted Web scope.
- P6: authentication, file boundaries, reconnect, lifecycle and resource ownership.
- P7: independent native dependency staging, distributions, CI and deployment documentation.
