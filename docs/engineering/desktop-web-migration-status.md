# Desktop / Web monorepo migration status

Started: 2026-09-21. Branch: `codex/desktop-web-monorepo`.

The accepted scope is recorded in [the migration plan](./desktop-web-refactor-plan.md).
This file records completed work and remaining acceptance checks. The independent
Web application now runs, but the full accepted release scope is not yet complete.

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

## P3 — Shared UI and desktop host

- Moved the shared React application, components, styles and 33 UI test files into
  `packages/ui`. Compiled ESM/declaration exports and React peer dependencies keep
  it consumable by both hosts. The browser-only TypeScript project has no Node
  ambient types. A boundary test rejects Node/Electron/runtime/MCP imports and
  direct access to the Electron global throughout shared UI source.
- `configureLinktermClient` injects the host client. Desktop bootstrap owns
  `window.linkterm`; shared components retain their existing `getLinkterm` calls.
  Tests verify host replacement and disconnection. The generated CSS hash still
  matches the baseline; the small JS change reflects client injection.
- Moved Electron main, preload, IPC channels, platform resolver, renderer bootstrap
  and their unit tests to `apps/desktop`. The root is now a scripts/tooling package;
  runtime dependencies belong to workspace members. Frozen offline installation
  passed without changing external dependency versions.
- Kept root `pnpm start`, Vite and old MCP executable entry points compatible.
  The desktop manifest's `productName: linkterm-v2` preserves the original Electron
  application name/data-directory behavior despite the scoped workspace name.
  Runtime diagnostics now watch compiled runtime, MCP and contracts packages plus
  the desktop main/preload/platform artifacts.
- Added `pnpm dev:desktop`: initial build, TypeScript watch, shared UI/CSS HMR and
  Electron restart only after successful backend builds. Restarts request ordinary
  app shutdown and await exit before replacing the process. Tests cover watched
  artifact selection, graceful shutdown and the unresponsive-child fallback.
- Full quality gate passed: lint, build, 177 test files / 2039 tests and licenses.
  Hidden Electron smoke passed using isolated data: main composition, migrated
  preload, session-list IPC and rendered shared UI. Screenshot inspection confirms
  the Start Center renders correctly. No hardware connection was opened.
- Before edits, 498 graph impact targets covered shared UI, desktop modules,
  bootstrap helpers and their tests: 9 CRITICAL, 33 HIGH, 11 MEDIUM, 345 LOW and
  100 UNKNOWN. `getLinkterm` has 47 direct callers / 22 grouped flows, `useT` has
  25 direct callers and preload invocation has 38. HIGH/CRITICAL findings were
  reported before changes. Unknown entries were supplemented by an AST reference
  inventory and Vitest discovery, including unused compatibility exports.
- Distribution/native dependency materialization remains P7 work. The Node server
  and Web app have not been implemented at this checkpoint.
- Removed all legacy/application/package build outputs and rebuilt from source.
  The refreshed graph contains 45,331 nodes / 88,358 edges / 495 enumerated flows.
  Pre-commit `detect_changes(scope=all)` reports 167 files / 50 changed symbols /
  23 affected flows, matching client injection, desktop bootstrap and development
  tooling. The cumulative `main` comparison reports 472 files / 1135 symbols /
  74 flows; its 1000-symbol list is truncated, so phase-local reports and the
  complete staged file diff were also reviewed.

## P4 — Independent Web runtime (implemented; regression review continuing)

- Moved desktop IPC behavior into 12 runtime client services with host ports;
  Electron handlers remain compatibility adapters. Contracts now provide one
  validated ClientAPI factory for desktop IPC and Web HTTP/WS. The browser bundle
  does not import Electron, runtime, MCP or native bindings.
- Added a Node server that owns one runtime, serves the Web bundle, and proxies an
  authenticated `/mcp` endpoint to the same runtime. HTTP commands use bounded
  request IDs and result lookup; WS carries terminal input and events. Browser
  disconnect does not destroy sessions or background jobs.
- Browser smoke on Windows validated token login, actual local-shell creation,
  PTY input/output, refresh restoration, server workspace selection and logout.
  An SDK Streamable HTTP client saw the browser-created session and all 63 MCP
  tools through the public Bearer endpoint. No hardware connection was opened.
- `pnpm dev:web`, `dev:server`, `start:server` and `pack:server` are available.
  The production Node service serves its own static Web assets; no Electron or
  Vite process is required after packaging.

## P5 — Host-specific Web behavior (partially implemented)

- Shared UI uses a browser-host workspace picker and firmware upload. The server
  limits picker IDs and real paths to configured roots, validates uploads and
  resolves opaque resource IDs when saving control profiles. Browser picker and
  control-profile root selection were verified in the real UI; synthetic firmware
  bytes were verified through API tests. No user file was uploaded during UI smoke.
- Server credentials use a dedicated AES-256-GCM key with provider/key ID metadata;
  desktop safeStorage format remains readable by desktop. A stopped-server
  migration CLI previews/imports connection metadata and strips old ciphertext.
- The server exposes activity, readiness, first-signal, connections, control
  profiles, J-Link/RTT and workflow services through the shared client service
  registrations. The server-host Codex Agent target now installs an HTTP MCP
  configuration in the server account's home without writing the access token
  into `config.toml`; the authenticated API test verifies the target and file.
  The same server integration test now probes connection records, control
  profile records, serial discovery, readiness, activity status and J-Link
  catalog lookup through the browser command boundary without hardware.
  A real browser login opened the Agent integration panel against an isolated
  server account and confirmed the Codex server-host target, HTTP transport,
  config path and explicit notice that Install / Repair writes to the server
  account rather than the browser device. A subsequent browser smoke installed
  the Codex HTTP config in that isolated account, then removed it and verified
  the file was empty with a backup retained. This exposed a missing-token case:
  the config existed but the UI disabled Remove because the integration was
  marked `needs-update`. Remove is now available for that state, with a UI
  regression test. The rest of the Web feature matrix and hardware behavior
  still need individual checks.

## P6 — Network and resource boundaries (partially implemented)

- Single-owner data-directory lock, cookie/CSRF/Origin/Host checks, loopback by
  default, explicit HTTPS public origin, login rate limiting, bounded request
  bodies/uploads, WS backpressure and command deduplication are implemented.
  Existing-file symlink escape tests pass. The runtime refuses to steal stale
  owner locks after a crash.
- Reconnect leaves uncertain writes unresent and offers request-status lookup.
  WebSocket hello and command waits, plus HTTP commands, now have bounded
  timeouts; fault tests confirm interrupted writes are never automatically
  resent. The Web app prunes stale tabs from an authoritative server snapshot
  while preserving desktop tab behavior, and lifecycle events received during
  a snapshot are not overwritten by it. Shutdown waits for accepted Web
  commands before unregistering handlers or disposing runtime resources;
  an in-flight PTY write test verifies that order. Runtime fault tests verify
  PTY/audit cleanup and retain the owner lock if disposal fails. Long-running
  slow-client behavior and multi-tab event races still need deeper acceptance
  checks.
  A two-client server test now verifies that only the selected UI-target tab
  may resize the shared PTY, and that selecting another tab transfers that
  authority without interrupting the session.
  A reconnect test also changes the runtime ID during a pending write: the Web
  transport never queries the new process for the old command, never resends
  it, and shows that its outcome cannot be recovered automatically.
  A slow-peer test verifies that the 4 MiB WebSocket backpressure cap closes
  that peer with code 1013 before queuing more event bytes.
  The two-client integration test now allows a bounded handoff interval after
  one browser observes its own socket close: server-side destruction and UI
  target transfer can finish slightly later. It still rejects any resize error
  other than the temporary `NOT_ACTIVE_CLIENT` state.
  A live HTTP/WebSocket integration test now disconnects a subscribed browser
  while its PTY remains open, emits output during the gap, then reconnects a
  second browser. The new client recovers both retained output chunks and
  receives new live transcript events without creating a second PTY.
  Shared-runtime integration coverage confirms that workflow jobs survive a
  peer disconnect and another client can query the same job. The shared UI now
  keeps polling an in-progress download job after transient Web transport
  errors, then re-queries that job after reconnecting; the start command is
  never resent. The UI test exercises a connection-loss response followed by
  the original job's completed status.
  Web also retains only the known job ID in origin-scoped `sessionStorage` after
  a start response. Refreshing the page queries that same job and shows its
  result in a page-level status area even before a control profile is opened;
  terminal status clears the stored ID. If a download or compensation start's
  HTTP response is lost while the same server runtime is reachable, the browser
  queries the bounded request ledger by the original request ID and can recover
  the original job response without starting a second job. An unavailable,
  expired or unretained ledger result stays uncertain and is never auto-retried.
  A real server restart test confirms the old browser cookie is rejected and
  a fresh login succeeds. The Web transport now checks `/api/session` after a
  WS disconnect; a 401 returns the browser to login without an endless retry
  loop, while preserving a warning for commands whose outcomes were unknown.

## P7 — Distribution (partially implemented)

- Windows `pnpm pack:server` produced a relocatable Node/Web directory with 160
  physical package copies, 125 CycloneDX components and 7036 checksums. It was
  copied to another path and passed startup, page, auth, native PTY loading,
  graceful shutdown and owner-lock release. The latest verified directory is
  `release/linkterm-server-win32-x64-1790145739687`, rebuilt after the latest
  Web download and reconnect changes.
- Windows `pnpm dist:desktop` produced NSIS and portable executables from a
  separate physical dependency tree (257 package copies, 178 CycloneDX
  components). A relocated packaged `app.asar` passed preload, shared UI and
  real PTY input/output. Four release-file checksums were generated. Native
  Electron and Node dependencies were never rebuilt in the shared workspace.
  The latest verified directory is `release/linkterm-desktop-win32-x64-1790145878597`,
  rebuilt after the latest shared UI change.
- Release-candidate CI now invokes both package/smoke commands. A Web deployment
  guide covers localhost, remote HTTPS proxy, data paths, credentials and
  connection metadata migration. Cross-platform release jobs and real hardware
  remain unverified on this Windows host.
- `dev:desktop` and `dev:web` now prepare separate physical pnpm deploy trees
  before launching their hosts. The host-native PTY/serial loaders resolve
  against their own tree, and shutdown removes that staging directory. A real
  Web development startup/proxy/cleanup smoke and a hidden Electron development
  PTY smoke passed on Windows; the short-lived Windows ConPTY helper emitted an
  `AttachConsole failed` message after the Electron smoke completed, so native
  behavior needs continued observation on physical hosts.
- The legacy standalone desktop stdio MCP entry passed a separate SDK client
  smoke: it advertised its 48 available tools and opened/closed a local PTY.
- Full quality gate passed at normal host permissions: lint, both application
  builds, 186 test files / 2068 tests and license attribution. A prior
  restricted sandbox run passed 2044/2047; its three audit-export/child-process
  failures also passed in a targeted normal-permission rerun (58/58).
- Before P4/P5 edits, 183 service/adapter targets were analyzed: 143 LOW,
  24 UNKNOWN, 1 MEDIUM, 11 HIGH and 4 CRITICAL. The preload invocation had 38
  direct callers / 3 flows, and serial lifecycle broadcast had 3 direct callers
  / 3 flows. HIGH/CRITICAL findings were reported before edits. Additional
  credential and Web entry analyses likewise preceded changes; new unindexed
  resources were supplemented with source and integration checks.
- The refreshed graph has 47,909 nodes, 94,733 edges and 591 enumerated flows.
  Pre-commit `detect_changes(scope=all)` reports 103 staged files, 1048 changed
  symbols and 179 affected flows; comparison with `main` reports 542 files,
  1769 symbols and 237 flows across P1–P7. Both symbol lists are truncated, so
  the complete staged file diff and phase-local impact reports were reviewed.
  Graph flow enumeration itself is budget-limited and must not be treated as a
  complete runtime call trace.
- This follow-up refreshed the graph to 48,184 nodes, 95,279 edges and 596
  enumerated flows. The phase-local `detect_changes(scope=all)` reports 13
  staged files, 64 changed symbols and 106 affected flows; comparison with
  `main` reports 543 files, 1809 symbols and 251 flows, with the cumulative
  symbol list truncated. The CRITICAL graph rating spans the intended Web
  transport, server lifecycle, shared UI and runtime shutdown paths; the
  complete staged diff and 2056-test quality gate were reviewed together.
- The multi-tab/native-isolation follow-up refreshed the graph to 48,255
  nodes, 95,539 edges and 595 budget-limited flows. Its phase-local staged
  detection reports 10 files, 27 changed symbols and 21 affected flows;
  comparison with `main` reports 544 files, 1816 symbols and 252 flows.
  The CRITICAL rating includes the expected Web server, native host loaders
  and development supervisors, and was checked against their targeted and
  full quality tests plus both relocated release smokes.
- The restart/relogin follow-up refreshed the graph to 48,359 nodes and 95,772
  edges. Its phase-local staged detection reports 7 files, 33 symbols and zero
  enumerated affected flows (LOW); this is a graph budget limit, not evidence
  that Web reconnect has no callers. The cumulative `main` comparison reports
  545 files, 1834 symbols and 252 flows. Fault tests, the 2060-test quality
  gate and the latest relocated Web package smoke provide runtime coverage.
- The Agent UI follow-up refreshed the graph to 48,368 nodes, 95,785 edges and
  595 budget-limited flows. Its phase-local detection reports 6 staged files,
  8 indexed symbols and 3 Agent panel flows (MEDIUM); the server test edit is
  not represented as a production symbol. The cumulative `main` comparison
  reports 545 files, 1835 symbols and 254 flows (CRITICAL, truncated). The
  2061-test quality gate and real browser panel smoke cover this change.
- The terminal reconnect acceptance test passes through a real Web server and
  WebSocket with a mocked PTY. Full quality gate after this addition passes:
  lint, both builds, 185 test files / 2062 tests and license attribution.
- The Agent removal follow-up passed a real browser install/removal cycle in an
  isolated server account. Full quality gate passes: lint, both builds, 185
  test files / 2063 tests and license attribution.
  Its refreshed graph has 48,420 nodes, 95,882 edges and 595 budget-limited
  flows. Phase-local detection reports 3 files, 5 indexed symbols and 3 Agent
  panel flows (MEDIUM); comparison with `main` reports 545 files, 1839 symbols
  and 254 flows (CRITICAL, truncated).
- The download-status reconnect follow-up also passes the complete 2063-test
  quality gate. Its UI regression checks that an interrupted status read does
  not turn a running job into a failure before the same job reports completion.
  GitNexus refreshed to 48,429 nodes / 95,895 edges. Phase-local detection
  reports 3 files, 6 indexed symbols and 9 root-App flows (HIGH); direct impact
  on the `poll` closure is LOW (1 caller, 1 flow, 2 modules). The HIGH result
  reflects the root component's broad graph reach, while the staged diff only
  retries three transient errors from the read-only job-status request.
- Web page-refresh job recovery passed the complete quality gate: lint, both
  builds, 185 test files / 2064 tests and license attribution. The test restores
  a known job ID, queries its terminal status and checks the visible result.
- Lost Web download-start responses can now recover the original ledger result
  while the same runtime is reachable. Transport tests cover both download and
  compensation, a missing ledger entry, and a server restart during the request;
  the server test asserts the retained result matches the original command.
  Full quality gate passes: lint, both builds, 185 test files / 2067 tests and
  license attribution. GitNexus refreshed to 48,553 nodes / 96,214 edges /
  595 budget-limited flows. Phase-local detection reports 4 files, 19 indexed
  symbols and 16 flows (CRITICAL) because the generic Web `invoke` entry can
  reach many commands; the diff restricts recovery to the two download starts.
  The cumulative `main` comparison remains CRITICAL and truncated.
- Shutdown concurrency and ownership checks pass: the request ledger completes
  accepted work before settling, refuses new work with `SERVER_STOPPING`, and
  retains the original response for duplicate IDs. Existing tests also confirm
  a stale or replaced data-directory lock is never silently taken or removed,
  runtime cleanup continues after an injected job-shutdown failure, and a slow
  Web peer is disconnected before another frame is queued. The latest full
  gate passes 186 test files / 2068 tests.

## Remaining acceptance work

- Verify the remaining Web service surfaces, including longer outages before a
  background-job ID is known and service-specific reconnect paths.
- Exercise abrupt process termination and manual stale-owner recovery, long
  duration slow-client behavior, and multi-tab event races on deployed hosts.
- Repeat development native-binding and legacy stdio smoke on Linux/macOS and
  with actual hardware.
- Run full quality and release gates across Windows, Linux and macOS; verify
  real serial/J-Link/RTT/firmware workflows with hardware when available.
