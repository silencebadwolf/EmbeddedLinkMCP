# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

LinkTerm v2 is an Electron/TypeScript rewrite of a legacy Qt/C++ terminal, intended as a unified desktop terminal + MCP automation platform. It serves four user roles simultaneously: desktop terminal users, embedded firmware developers, AI hosts (MCP clients), and project maintainers.

Authoritative specs live in `PROJECT_REQUIREMENTS.md` (requirements) and `DEVELOPMENT_PLAN.md` (13-phase plan with current status). **Always check `DEVELOPMENT_PLAN.md` before starting work** — it tracks which phases are completed (✅), in progress, or not started (⬜), and records every decision/variance from the original plan.

Current state: **Phases 0–5 complete** (scaffolding, core session/transcript/write-queue, serial transport + discovery + IPC, SSH + local-shell adapters, MCP terminal surface with 8 tools, AI-human coop hardening with priority/backpressure/multi-subscriber). Phases 6–12 not yet started. 172 Vitest tests cover `src/core/`, `src/transports/{serial,ssh,local-shell}/`, `src/mcp/`, and the AI-human coop integration scenarios; the renderer is still a placeholder with no IPC bridge or terminal UI yet.

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
