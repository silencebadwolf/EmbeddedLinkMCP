# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

LinkTerm v2 is an Electron/TypeScript rewrite of a legacy Qt/C++ terminal, intended as a unified desktop terminal + MCP automation platform. It serves four user roles simultaneously: desktop terminal users, embedded firmware developers, AI hosts (MCP clients), and project maintainers.

Authoritative specs live in `PROJECT_REQUIREMENTS.md` (requirements) and `DEVELOPMENT_PLAN.md` (13-phase plan with current status). **Always check `DEVELOPMENT_PLAN.md` before starting work** — it tracks which phases are completed (✅), in progress, or not started (⬜), and records every decision/variance from the original plan.

Current state: **Phases 0–11 complete** (scaffolding, core session/transcript/write-queue, serial transport + discovery + IPC, SSH + local-shell adapters, MCP terminal surface with 8 tools, AI-human coop hardening, Electron renderer UI with xterm.js + connection dialog + i18n + shadcn primitives, embedded terminal rules + sendAndWait FSM, workspace config persistence with 3 MCP tools, J-Link MCP debug surface with 28 tools + NullBackend default, UI MCP surface with `ui_configure` 4-action discriminatedUnion + `ui_screenshot` 16 MiB-capped PNG + UI_NOT_AVAILABLE always-register policy, **bidirectional license validation: manifest ↔ package.json + version strict equality + EXTRA_RUNTIME_DEPS allowlist for electron**). Phase 12 not yet started. 473 Vitest tests cover `src/core/`, `src/transports/{serial,ssh,local-shell}/`, `src/core/terminal-rules/`, `src/core/workspace/`, `src/jlink/`, `src/mcp/`, AI-human coop integration, send-and-wait integration, the renderer (happy-dom hooks/components), `session:create` IPC, Phase 10 UI bridge + ui surface, and Phase 11 license-validation script (11 unit tests).

## Common commands

- `pnpm install` — install dependencies (pnpm is required, not npm)
- `pnpm run build` — full build: `tsc -b` (composite project) + `vite build` (renderer)
- `pnpm run build:main` / `pnpm run build:renderer` — build one side only
- `pnpm test` — run all Vitest tests once
- `pnpm test -- path/to/file.test.ts` — run a single test file
- `pnpm test -- -t "test name"` — run tests matching a name
- `pnpm run test:watch` — watch mode
- `pnpm run lint` — ESLint over `src/` and `tests/`
- `pnpm run validate:licenses` — verify `third-party-manifest.json` ↔ `licenses/` ↔ `package.json` consistency
- `pnpm start` — launch built Electron app (must run `build` first)
- `pnpm run dev` — Vite dev server for renderer only (main still needs build)

## Architecture

### Process model (target — most not yet built)

- **Main Process** owns ALL state: `SessionManager`, `TranscriptBuffer`, `WriteQueue`, transport adapters, MCP server, workspace config, J-Link backend abstraction. Renderer is a thin shell.
- **Renderer Process** is React + xterm.js, talks to main exclusively over IPC.
- **MCP Server** runs inside the main process and shares the same `SessionManager` instance with the UI — this is the load-bearing invariant for "AI and human operate the same session" (req §4.5).
- **IPC**: request/response uses `ipcRenderer.invoke` / `ipcMain.handle`; streaming terminal data flows as events.

### The single most important architectural rule

Every write to a session — whether from the UI (origin=human) or from MCP (origin=ai) — MUST flow through `SessionManager.write` → `WriteQueue` → transport. The `WriteQueue` is the single serialization point that guarantees consistent ordering between AI and human inputs and produces the audit trail. **Never let MCP tools or IPC handlers touch transports directly.** This is a hard security boundary (req §4.4, §5.1).

`TranscriptBuffer` is append-only with a monotonically increasing sequence cursor. Clear events are recorded in the buffer (not deletions) so MCP clients reading from an old cursor still see history boundaries (req §4.5 — clear must not lose AI-readable evidence). Clear events carry `meta.kind: 'clear'` and `meta.precedingCursor` (the last sequence visible before the clear) — these fields are forced by `TranscriptBuffer.append` regardless of caller-supplied meta. When a reader's cursor falls below the ring buffer's earliest sequence, `readSince()` returns `{ events, truncated: true, oldestAvailableSequence }` instead of throwing — clients use that sequence minus one as their new cursor to recover.

### WriteQueue priority & backpressure (Phase 5)

`WriteQueue.enqueue(item)` accepts `priority: 'high' | 'normal'` (default `normal`) and a `maxDepth` cap (default 1024). Two FIFO lanes; if the high lane is non-empty, the next item drained is from high. **`priority: 'high'` is exempt from `maxDepth`** — the high lane is reserved for user-initiated Ctrl-C / abort signals that MUST get through when normal traffic has saturated the queue. Don't use `'high'` for routine MCP writes; the audit notes in `src/core/write-queue/types.ts` are the contract. When `maxDepth` is hit on the normal lane, enqueue rejects synchronously with `WriteQueueFullError` (`code: 'QUEUE_FULL'`); callers decide retry/backoff. The `priority` field is plumbed end-to-end: `SessionWriteOptions.priority` → `SessionBase.write` → `WriteQueue.enqueue`. The IPC `session:write` handler accepts it from the renderer (still forces `origin='human'`); MCP tools currently always submit `normal`.

### Session error taxonomy

`SessionBase.write` throws `SessionNotOpenError` (`code: 'NOT_OPEN'`, exported from `src/core/session/index.ts`) when the session isn't in the `open` state. Both the IPC `session:write` handler and the MCP `write_to_session` tool translate this via `instanceof` to a structured `{ code: 'NOT_OPEN', sessionState }` result — keep using the named error rather than string-matching the message, so renames don't silently break the taxonomy.

### Multi-subscriber transcript reads (Phase 5)

For long-lived consumers (renderer windows, MCP clients) `SessionManager` exposes `subscribe(subscriberId)` / `unsubscribe(subscriberId)` / `readForSubscriber(subscriberId, sessionId)` / `getSubscriberCursor(...)`. Internally it tracks `Map<subscriberId, Map<sessionId, cursor>>`. The IPC `session:transcript:subscribe` handler assigns one subscriberId per `webContents` and auto-unsubscribes when the renderer's `webContents` emits `'destroyed'` (registered with `if (!subscribers.has(wc.id))` so repeat subscribes don't pile up `'destroyed'` once-listeners). Short-lived MCP `read_from_session` calls still pass cursor explicitly and use `TranscriptBuffer.readSince` directly — both paths coexist.

### `SessionManager.waitFor`

`waitFor(sessionId, predicate, opts)` returns a `WaitForOutcome` with `kind: 'matched' | 'timeout' | 'closed'`. It listens to both transcript events AND session `'state'` transitions: if the session enters `closed` or `errored` while waiting, it settles immediately as `{ kind: 'closed', state, lastCursor }` rather than waiting out the full timeout. This matters for Phase 7's `sendAndWait` — needing to distinguish "predicate didn't fire in time" from "the device is gone." Concurrent `waitFor` calls on the same session are independent (each registers its own predicate + state listeners; cleanup is per-call).

### IPC origin enforcement (req §4.4 / §5.1 hard boundary)

The renderer is trusted but **must not be able to forge AI identity**. The IPC `session:write` handler hardcodes `origin: 'human'` and ignores any `origin` field in the request payload. AI writes go through MCP tools (origin: `'ai'`); the two channels are strictly separated and recorded distinctly in transcripts.

### Module layout (`src/`)

```
main/        Electron main process, IPC handlers
core/        Pure business logic — ZERO Electron dependencies
  session/         ISession, SessionManager
  transcript/      TranscriptBuffer, sequence cursors
  write-queue/     WriteQueue (single serialization point)
  terminal-rules/  Embedded terminal rules + sendAndWait FSM (Phase 7)
  workspace/       Workspace config persistence (Phase 8)
transports/  Adapter implementations of ITransport (serial, ssh, local-shell)
mcp/         MCP server + 3 tool surfaces (terminal, debug, ui)
jlink/       J-Link backend abstraction (null-backend safely rejects when no backend injected)
renderer/    React UI, xterm.js
shared/      Cross-process types and IPC channel names
```

`src/core/` MUST stay free of Electron imports — it's pure TypeScript using `EventEmitter` and the `ITransport` interface, so it can be unit-tested without launching Electron, hardware, SSH servers, or J-Link devices (req §5.2).

### Transport adapters use factory-based dependency injection

Every `ITransport` adapter (`SerialTransport`, `SshTransport`, `LocalShellTransport`) takes its underlying native client through an optional factory parameter — see `SerialPortFactory` in `src/transports/serial/serial-port-like.ts`, `SshClientFactory` in `src/transports/ssh/ssh-client-like.ts`, `PtyFactory` in `src/transports/local-shell/pty-like.ts`. Production code falls through to the real default factory; tests inject a fake (`tests/fixtures/mock-{serialport,ssh,pty}.ts`) and drive events synchronously. **Do not import `serialport`/`ssh2`/`node-pty` directly inside session or core code** — only the adapter's `*-{port,client}-like.ts` interface and default factory may touch the native module. Default factories use `createRequire(import.meta.url)` to load native modules lazily, so the unit-test suite runs without the native bindings being present.

### Transport invariants (learned from Phase 3 review)

- **Each adapter MUST emit `'close'` exactly once** — main-process consumers (SessionBase, IPC bridge) hang forever if it never fires. When `close()` is called, do NOT set the "closed" flag synchronously and let the underlying-library `'close'` event short-circuit itself away. Use a separate `#closeEmitted` flag, or schedule the emit via `queueMicrotask` so SessionBase has a tick to settle state first.
- **All Duplex-like channels (ssh2 `ClientChannel`, pty data) need `'error'` listeners** — otherwise Node escalates them to `uncaughtException`.
- **`close()` must dispose data listeners synchronously** — between SIGHUP and actual exit, a child PTY (or remote shell) keeps producing bytes; if the listener is still attached they leak into the transcript after `state==='closed'`. See `LocalShellTransport.#disposeListeners`.
- **SSH credentials are field-only at construction**, then nulled inside `open()` before any `await`. Never put them on the config object, never let them reach `TranscriptBuffer` (req §4.4 / §5.1). `hostVerifier` is REQUIRED — there is no acceptAll default; TOFU/known_hosts is Phase 8 work.
- **PTY non-zero exit ≠ errored** — `LocalShellSession` records exit as a `state` transcript event with `meta:{kind:'pty-exit', exitCode, signal}` and lets the session reach `closed` normally. Non-zero is a legitimate business outcome (compile errors, grep miss).
- `SessionBase` exposes `protected recordSystemEvent(input)` for subclasses to push system-origin transcript events without exposing the private `#appendAndEmit`. Use this for PTY exit / future SSH banner-style events; do NOT bypass it by emitting on the EventEmitter directly.
- `ISession.resize?(cols, rows)` is **optional** — serial sessions don't have a window concept. Callers must check `typeof session.resize === 'function'` before invoking.

### MCP tool surfaces are isolated

Three independent surfaces, never mixed:
- **Terminal surface** — session ops (read/write/sendAndWait/discover ports). Output is `EvidenceKind.terminal_output`.
- **Debug surface** — J-Link probe/CPU/flash/RTT/GDB. Output is `EvidenceKind.debug_output`. When no backend is injected, every operation returns `{ success: false, error: { code: 'NO_BACKEND' } }` — never falls back to executing external CLIs (req §4.6).
- **UI surface** — `ui_configure` (whitelisted: language/connection-type/field values only) and `ui_screenshot` (PNG via `BrowserWindow.webContents.capturePage()`). Output is `EvidenceKind.ui_screenshot`.

Each MCP tool returns `{ success, sessionId?, state?, evidence: { kind, data, cursor }, error?, correlationId, origin: 'ai' }`.

### Renderer ↔ preload contract (Phase 6)

The only renderer→main channel is `window.linkterm`, injected by `src/main/preload.ts` via `contextBridge.exposeInMainWorld`. The shape lives in `src/shared/preload-api.ts` (`PreloadAPI` interface + `declare global`). Both sides import this single source of truth — adding a new IPC method means updating preload-api.ts FIRST, then preload.ts and the renderer caller; otherwise the type assertion silently drifts.

**Browser-mode safety**: `window.linkterm` is undefined when the renderer is loaded outside Electron (Vite dev server in a plain browser tab, Storybook, Playwright). Every renderer call site MUST use `getLinkterm()` from `src/renderer/lib/linkterm-bridge.ts` and early-return when it's null — do NOT chain optional access (`window.linkterm?.session?.write?.(...)`) at the call site, since that pattern hides legitimate "preload missing in production" bugs.

**Transcript hydration is subscribe-only**: `useTranscript` registers `transcript.onEvent` BEFORE calling `session.subscribe`, then renders the snapshot returned in `subscribe()`'s `events` field — there is no `read({cursor:0})` path. Phase 6 review C1 removed the original read+subscribe combo because of an unfixable race: events arriving between `read` resolving and `subscribe` registering would either be lost or replayed on top of the read snapshot.

**Origin/credentials boundary recap**: the renderer is trusted but its IPC payload is sanitized server-side. `session:write` ignores any caller-supplied `origin` and forces `'human'`; `session:create` for SSH receives `credentials` as a separate top-level field (`SessionCreateRequestConfig`'s SSH branch), and `buildSession()` in `src/core/session/factory.ts` wipes them before any await. Never reintroduce a flow that puts credentials inside `SshSessionConfig` proper.

### Terminal rules & sendAndWait FSM (Phase 7)

`src/core/terminal-rules/` is a self-contained module independent of `SessionManager` proper. It exposes a `SessionManagerLike` structural interface (`write` / `waitFor` / `read`) so `sendAndWait` is a pure orchestrator function, unit-testable without touching transports. The MCP `send_and_wait` tool injects the real `SessionManager` via structural typing — no `as unknown` cast needed.

**`completionMarkers` is `(string | RegExp)[]` at the core layer**. Strings are matched via a precomputed KMP failure table so cross-chunk overlapping patterns (`ABABA` consuming `ABABC`) resolve correctly. RegExp markers run on a UTF-8 accumulating buffer; `nonStateful` copies (with `g`/`y` flags stripped) are precomputed once in the detector ctor — never call `new RegExp` on the feed hot path. The buffer tail-window is `bufferMaxBytes` when no RegExp markers exist, otherwise `min(bufferMaxBytes, max(longestRegex*4, 4096))` so RegExp pattern length never exceeds buffered context.

**At the MCP/IPC boundary**, `completionMarkers` accept `string | { pattern: string; flags?: string }`. `parseMarkerSpec` (`src/mcp/surfaces/terminal/schemas.ts`) converts to native `string | RegExp` before passing into core. `flags` is constrained to `/^[dimsu]*$/` — `g` and `y` are explicitly forbidden because they pollute `lastIndex` across chunks.

**`SendAndWaitResult` failure reasons are structured, not strings**: `'matched' | 'timeout' | 'session-closed' | 'queue-full' | 'aborted'`. The MCP layer translates each to a stable `ToolErrorCode`: `TIMEOUT`, `SESSION_CLOSED`, `QUEUE_FULL`, `INVALID_ARGUMENT`. **Don't add new reasons without also adding the matching `ERROR_CODES` entry and `ToolErrorCode` union member** — the registry's instanceof-translation contract depends on this 1:1 mapping. Empty `completionMarkers` array triggers fallback "any device output matches" behavior (Phase 4 backward compat); in that case `matchedMarkerIndex` is `null` (not `-1`) to avoid invalid-index ambiguity.

**EchoHandler is byte-precise**: FIFO `expected[]` queue, first-byte mismatch flushes the whole queue conservatively. Long-running echo-off devices are protected by `MAX_QUEUE_LEN=4096` — beyond that, the queue auto-flushes. Strategy is `'auto' | 'keep'` only — there is no `'strip'` (was a Phase 7 review redundancy).

**AbortSignal semantics**: pre-aborted calls short-circuit BEFORE write — no transport bytes, no observeWrite, `bytesWritten=0`. During-wait abort uses `Promise.race` with a once listener; the underlying `SessionManager.waitFor` does not yet accept a signal, so its listeners/timer linger until natural timeout (Phase 8 backlog item — record but don't paper over).

### Workspace config persistence (Phase 8)

`src/core/workspace/` is the first runtime fs IO in the project. `WorkspaceConfigManager` persists 5 config sections (`chip` / `flash` / `debug` / `rtt` / `serial`) to `<workspaceRoot>/.linkterm/config.json` with `schemaVersion: 'linkterm-workspace/1.0.0'`. The manager takes 2 DI points — `FsPrimitives` (6 methods incl. `unlink`) and `evidenceFn` — keeping core Electron-free and unit-testable without real disk.

**Single-process serialization**: `init()` and `update()` route through `#inflight: Promise<unknown>` (chained via `.catch(() => {})` to avoid poisoning) so two concurrent `update(root, patch)` calls cannot lose-update. `load()` stays outside the lock (read + atomic single-statement reassignment of `#current`). Don't replace this with advisory locks — single LinkTerm process is the only writer.

**Schema-level credential rejection is the security boundary**: every Zod object uses `.strict()` at every layer (root + 5 sections + patch) so unknown keys (`password`, `privateKey`, `passphrase`, `token`, `secret`) are rejected synchronously at parse time. No runtime refine, no blocklist — adding a new section means a new `.strict()` schema, not a new credential filter. Patch schema does NOT allow `schemaVersion` to prevent silent migrations.

**Atomic write with cleanup**: `#writeAtomic` writes to `<file>.tmp` then `rename`s; on failure the tmp is best-effort `unlink`ed (cleanup error swallowed, original error rethrown). POSIX/Win32 same-volume rename is atomic. Don't introduce backup/rotate logic without re-verifying the lock interaction.

**Path safety**: workspace root must be absolute and `..`-free. Validation lives both at the schema boundary (`schemas.ts` `.refine`) and inside the manager (`assertValidRoot`) — defense in depth so non-MCP callers can't bypass.

**Conflict report sanitization**: `WorkspaceConflictError` carries the full `ConflictReport` (with `configured` / `actual` values), but `tools.ts` strips those fields before placing the report in `ToolError.details`. Only `field`, `severity`, `message` cross the MCP boundary — never echo configured values back to the AI client (future-proofs against e.g. serial paths becoming sensitive).

**Error code expansions**: `WORKSPACE_NOT_FOUND` / `WORKSPACE_ALREADY_INITIALIZED` / `WORKSPACE_CONFLICT` / `WORKSPACE_SCHEMA_VERSION_MISMATCH` are added to BOTH `ERROR_CODES` (in `src/shared/error-codes.ts`) AND `ToolErrorCode` union (in `src/mcp/registry.ts`). Translation in `tools.ts` is `instanceof`-based (mirrors session error taxonomy) — adding a new domain error means adding both halves of the pair plus a translation branch.

**MCP surface is isolated**: workspace tools live in their own `src/mcp/surfaces/workspace/` directory; `EvidenceKind` gained `'workspace_config'`. The `workspaceConfigManager` injection into `CreateMcpServerOptions` is **optional** — when omitted, the 3 workspace tools are not registered. This preserves backward compatibility with terminal-only MCP test fixtures.

### J-Link MCP debug surface (Phase 9)

`src/jlink/` is the J-Link backend abstraction (28-method `IJLinkBackend` interface + 8 domain errors); `src/mcp/surfaces/debug/` is the 28-tool MCP surface that talks to it. Both directories MUST stay free of Electron imports (parallels `src/core/` rule) and MUST use relative imports with `.js` (no `@/` in main-process code).

**Always-register + default NullJLinkBackend**: unlike workspace's "skip-if-no-dep" pattern, debug tools are ALWAYS registered. When no real backend is injected, `createMcpServer` defaults to `new NullJLinkBackend()`, whose every method throws `NoBackendError` → translated to `{ success: false, error: { code: 'NO_BACKEND' } }`. The contract (req §4.6) is that AI clients see all 28 tools and get structured rejection — they must NOT see "tool does not exist." Don't switch this to skip-if-omitted.

**Error contract**: `IJLinkBackend` methods THROW `JLinkError` subclasses (mirrors SerialTransport/SshTransport/WorkspaceConfigManager). The MCP layer's `runJLink<T>(fn)` wrapper catches and `translateJLinkError(err)` does the `instanceof` ladder. **`decodeBase64Capped` calls MUST be inside `runJLink(...)`** — it throws `JLinkBufferTooLargeError` and the test that catches this is `tools-binary.test.ts`'s "rejects oversize payload before allocation."

**8 new ERROR_CODES with bidirectional sync (M5 pattern)**: `NO_BACKEND`, `PROBE_NOT_FOUND`, `PROBE_BUSY`, `JLINK_OPERATION_FAILED`, `BUFFER_TOO_LARGE`, `ABORTED`, `INVALID_STATE`, `NOT_IMPLEMENTED` are added to BOTH `ERROR_CODES` (in `src/shared/error-codes.ts`) AND `ToolErrorCode` union (in `src/mcp/registry.ts`). Each `JLinkError` subclass has a `code` field aligning to one of these — adding a new domain error means adding both halves of the pair plus a `translateJLinkError` branch.

**probeId is UUID v4, never serialNumber**: `JLinkAdapter.probeConnect` is the unique mint point (`crypto.randomUUID()`); the adapter holds `Map<string, ProbeHandle>`. The MCP layer's `sanitizeProbeForMcp` helper strips `serialNumber` from `ProbeInfo` before returning evidence — serial numbers can double as J-Link license keys (per Phase 9 Q3) and must not cross the MCP boundary. If you add new probe-identifying fields, decide explicitly whether they go through this sanitizer.

**Binary I/O — `Buffer` at backend, base64 at MCP, 16 MiB cap**: `MAX_BINARY_BYTES = 16 * 1024 * 1024` in `src/mcp/surfaces/debug/binary-codec.ts`. `decodeBase64Capped` does TWO checks: (1) `base64Field.max(MAX_BASE64_INPUT_LEN)` at the schema level, (2) stripped-length short-circuit BEFORE `Buffer.from(...)` — prevents allocating gigabyte-scale buffers from a malicious AI client. Empty/whitespace-only base64 is rejected with `INVALID_ARGUMENT`. **Don't reorder the size check after decoding**; the "size after decode" path was the H1 finding from Phase 9 review.

**AbortSignal on long ops**: `flash_download` / `flash_verify` / `gdb_server_start` accept top-level `timeoutMs` in their schemas; `withAbortableTimeout` (in `error-translate.ts`) wraps an `AbortController` with `setTimeout` and passes the signal as the LAST positional argument to the backend method. Backend implementations throw `JLinkAbortedError` on `signal.aborted`; the translate layer maps this to `ABORTED`.

**Sensitivity classification (read-only=9 / state-affecting=19)**: read-only tools are `probe_detect`, `probe_status`, `breakpoint_list`, `register_read`, `register_list`, `memory_read`, `rtt_search`, `snapshot_capture`, `crash_diagnose`. **`rtt_read` is state-affecting** (it advances the hardware ring buffer's read pointer). The remaining 19 are write/run/connect operations. This classification drives schema-version mismatch policy: state-affecting tools reject on mismatch; read-only tools warn. Don't reclassify without thinking about how a stale AI client would behave.

**Phase 9 stub vs Phase 13 real backend**: `JLinkAdapter` implements probe lifecycle (`probeDetect` returns `[]`, `probeConnect/Disconnect/Status` real with internal `Map`); every other method calls `requireProbe(probeId)` then throws `JLinkNotImplementedError`. Phase 13 will replace those stubs without touching the MCP layer or `IJLinkBackend` interface — the MCP layer's `instanceof` ladder already covers every domain error subclass. **Don't cast through this layer for early integration**; if you need a fake for tests, use `tests/fixtures/fake-jlink-backend.ts` (calls ledger + `failOnce` / `delayMs` injection points).

### UI MCP surface (Phase 10)

`src/mcp/surfaces/ui/` is the 2-tool MCP surface (`ui_configure` + `ui_screenshot`); `src/main/ipc/ui-bridge.ts` is the Electron adapter. Both `src/mcp/surfaces/ui/` and `src/mcp/limits.ts` MUST stay free of `electron` imports — only structural interfaces (`CapturableWindow` / `CapturableImage` / `UiPatchTarget`) cross the boundary.

**Always-register + UI_NOT_AVAILABLE default**: same pattern as `NullJLinkBackend` — `createMcpServer` defaults `uiBridge=null` / `getActiveWindow=()=>null` and registers both tools unconditionally. Without injection, every call returns `{ success: false, error: { code: 'UI_NOT_AVAILABLE' } }`. AI clients see all tools and get structured rejection.

**`getActiveWindow` MUST be a thunk reading module-scope on every call**: MCP server is constructed BEFORE `mainWindow` is created, and macOS `'activate'` rebuilds replace the module singleton. Capturing `mainWindow` at construction time leaks a destroyed reference. See `src/main/index.ts` `getMainWindow()` + `src/main/ipc/index.ts` `getActiveWindow` wrapper.

**`ui_configure` is `discriminatedUnion('action', [...])`** — 4 actions (`set_locale` / `set_connection_type` / `open_connection_dialog` / `close_connection_dialog`), each branch + the prefill object + the root all `.strict()`. The `nonSensitivePrefillSchema` enforces an 11-field whitelist that NEVER includes `sshPassword/sshPrivateKey/sshPassphrase` — Zod rejects unknown keys at parse time. Adding a new action means a new strict schema branch + ensuring sensitive credential fields stay out of the prefill whitelist.

**`UI_STATE_PATCH = 'ui:statePatch'` is main→renderer one-way broadcast**: `applyPatch` iterates `BrowserWindow.getAllWindows()` with `wc.isDestroyed()` guard + try/catch around `wc.send` (destroyed-mid-loop is silently skipped — the H2 Phase 10 review fix). When a second BrowserWindow type is added (settings panel etc.), switch back to a `subscribers: Map<wcId, WebContents>` mirror of `session-ipc.ts:80` to prevent cross-window patch leakage.

**16 MiB binary cap shared with debug surface**: `MAX_BINARY_BYTES` lives in `src/mcp/limits.ts` (NOT `src/mcp/surfaces/debug/binary-codec.ts` anymore — Phase 10 review M1 moved it). `binary-codec.ts` re-exports for backward compat. UI screenshot path: `image.toPNG()` Buffer → check `byteLength > MAX_BINARY_BYTES` → THEN base64. **Don't reorder check-after-encoding**; it allocates a 4/3× string before failing.

**ConnectionDialog prefill flow**: `setConnectionDialogPrefill(...)` writes into Zustand; `ConnectionDialog.tsx` useEffect runs ONLY on `open: false→true` edge with dependency list strictly `[open]` (never include prefill — AI patches mid-typing would clobber user input). Prefill type is auto-inferred from SSH/local-shell field presence when `prefill.type` is omitted, so `prefill_connection_form({ sshHost: 'x' })` lands in the SSH branch with sshHost visible.

**Evidence kind reuse**: both `ui_configure` and `ui_screenshot` use `EvidenceKind = 'ui_screenshot'`; `data` shape distinguishes them (`{ dispatched: patch }` vs `{ mimeType, base64, width, height, byteLength }`). Don't add a separate `'ui_patch'` kind without a strong reason — Phase 10 Q10 explicitly chose to keep the union narrow.

**`UI_NOT_AVAILABLE` dual-sync (M5 pattern)**: present in BOTH `src/shared/error-codes.ts` `ERROR_CODES` AND `src/mcp/registry.ts` `ToolErrorCode` union. Adding new UI domain errors requires both halves.

## Build configuration peculiarities

- **ESM only**: `package.json` has `"type": "module"`. Main process must derive `__dirname` via `import.meta.url` (`fileURLToPath(import.meta.url)`).
- **Main entry path is `dist/main/main/index.js`** (note the double `main`). This is a side effect of TypeScript composite + `rootDir: src`. `package.json` `main` field is set accordingly — don't try to "fix" it without also adjusting `tsconfig.main.json`.
- **`tsconfig.renderer.json` has `rootDir: "src"`** (not `src/renderer`) so it can include `src/shared`. Don't tighten this without finding another way to share types.
- **Tailwind v4** uses `@tailwindcss/postcss` (separate package), NOT `tailwindcss` directly as a PostCSS plugin. CSS uses `@import 'tailwindcss';`.
- TypeScript is strict mode. ESLint uses flat config (`eslint.config.js`) with `typescript-eslint`.

### Path alias `@/` is asymmetric — don't use it everywhere

`@/*` → `src/*` is configured in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts`. But **`tsc` does not rewrite path aliases in emitted JS** — it only resolves them at type-check time. The main process is built by `tsc` and run directly by Node/Electron with no bundler in the loop, so `@/foo` in a main-process source file becomes a literal `@/foo` in `dist/` that Node cannot resolve at runtime.

Rule:
- **Renderer code and tests**: use `@/...` freely (Vite and Vitest rewrite it).
- **Main process and `src/core/` code**: use **relative imports** (`../shared/types.js`), with `.js` extension as required by ESM.

If you "globally replace `../../` with `@/`" again, the build will pass `tsc -b` but the app will crash at startup with `ERR_MODULE_NOT_FOUND`.

### Dev mode startup ordering and CSP

`pnpm run dev` only starts Vite — main process still needs `pnpm run build:main` (or full `pnpm run build`) before `pnpm start`. Electron may launch before Vite is ready; `src/main/app-lifecycle.ts` handles this with a `did-fail-load` retry loop (500ms × 20). Do not remove the retry without ensuring Vite is up first, or the renderer ends up stuck on a `chrome-error://` page that can't even reload localhost (different origin).

CSP is injected as a response header via `session.defaultSession.webRequest.onHeadersReceived`, with different policies for dev (loose, allows Vite HMR `'unsafe-eval'` + `ws:`) and prod (`default-src 'self'`). **Don't put a `<meta http-equiv="Content-Security-Policy">` in `index.html`** — it would block Vite HMR in dev.

## Licensing discipline

Every runtime third-party dependency MUST be recorded in `third-party-manifest.json` AND have its license file present at `licenses/<name>.LICENSE`. `pnpm run validate:licenses` enforces this bidirectionally. **When you add a runtime dependency, update both files in the same change** — CI/validation will fail otherwise (req §4.10).

**Bidirectional validation contract (Phase 11)**: `scripts/validate-licenses.ts` exports a pure `validateLicenses({ manifestPath, packageJsonPath, rootDir })` function (the entry `main()` is just a thin wrapper) and enforces 4 invariants:

1. **Manifest internal consistency** — every entry has `name/version/license/licenseFile` and the file exists at `<rootDir>/<licenseFile>`.
2. **package.json → manifest (missing detection)** — every key in `package.json.dependencies` (plus `EXTRA_RUNTIME_DEPS` allowlist) must appear in `manifest.dependencies`.
3. **manifest → package.json (extra/stale detection)** — every manifest entry must be in `package.json.dependencies` or in the allowlist; deleting a dep without removing its manifest entry fails.
4. **Version strict equality** — `manifest.version === package.json.dependencies[name]` (string comparison, no semver). Bump-without-relicense fails.

`EXTRA_RUNTIME_DEPS = ['electron']` is the allowlist for "in devDependencies but runtime-distributed" — adding to it requires the dep actually exist somewhere in package.json (anti-stale check). Error messages distinguish `(from package.json)` vs `(from EXTRA_RUNTIME_DEPS allowlist)` to avoid self-contradiction when an allowlist item is removed from package.json. The script is unit-tested via `tests/unit/scripts/validate-licenses.test.ts` (11 cases covering all 4 invariants + missing/corrupt JSON + multi-error accumulation); use `mkdtempSync` + `afterEach rm -rf` fixtures, not real-repo paths.

Open-source projects can be referenced for design ideas, but source code copying requires prior license review and attribution. The `jlinkmcp` repo (https://github.com/daikw/JLinkMCP) has no declared license — design references only, no source copying (req §4.11).

## Working with this codebase

- Before implementing a phase, read its section in `DEVELOPMENT_PLAN.md` (look for the status badge ⬜/🟨/✅) and the relevant requirements section.
- When a user decision changes the plan, record it in the phase's "变更记录" subsection in `DEVELOPMENT_PLAN.md` — this is how the plan stays trustworthy across sessions.
- Tests for `src/core/` must run without Electron/hardware. The codebase uses Vitest, not Jest.
- The legacy Qt implementation may still exist somewhere in user history but **must not be used as a backend for v2 acceptance** (req §4.1).

# 注意

1. 每次 Phase 完成后，需要更新 [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md) 文档的进度
2. 生成的方法函数需要添加 JSDoc 注释，说明函数的功能、参数和返回值
3. 代码需要符合项目的 ESLint 规则，确保代码风格一致
4. 在提交代码前，请确保所有相关的测试都已通过，并且新添加的功能都有相应的测试覆盖
5. 任何第三方依赖都必须符合项目的许可证要求，并且需要在 `third-party-manifest.json` 中进行记录，同时在 `licenses/` 目录下添加对应的许可证文件
6. 在实现 MCP 工具时，必须严格遵守项目的安全边界要求，确保所有 MCP 请求都通过 LinkTerm 自有抽象层进行处理，避免直接调用系统工具，确保安全性和可维护性
7. 在设计 UI 时，必须确保不同连接类型的参数字段清晰展示，避免用户混淆，同时提供明确的模式选择和说明，提升用户体验
8. 用中文回复我
