## Why

Phase 2 makes AI activity visible, but a new user still lands in a transport-oriented empty state and must know which serial/profile/workspace path to choose. The next independently shippable slice is Runtime Readiness + Start Center: LinkTerm should inspect safe local facts, explain what is ready or blocked, show device/profile candidates with evidence, and route the user into the existing connection flow without claiming the Phase 4 first-signal journey is complete.

## What Changes

- Add a Main/core `RuntimeReadinessService` that aggregates read-only runtime, serial discovery, optional workspace/profile, reusable session, and agent-integration facts into a versioned, display-safe snapshot. Provider failures are isolated; one slow/broken provider must not erase other facts.
- Add a `DeviceCandidateResolver` and `SerialConnectionDraft` contract that preserve candidate evidence, confidence, parameter source, and connection side-effect metadata across Start Center, details, manual entry, advanced form, and session creation.
- Add readiness IPC/preload APIs with generation/revision semantics and strict shared schemas. Renderer accepts latest generation only and treats stale, malformed, or failed updates as safe diagnostics.
- Add a versioned readiness preferences adapter for recent workspace/profile and dismissed Start Center hints. Corrupt or unknown versions fall back to safe defaults with diagnostics and do not block readiness.
- Replace the no-session empty canvas with a task-oriented `StartCenter` that shows one primary intent, a compact readiness checklist, recent/profile suggestions, manual serial entry, refresh, diagnostics/copy summary where safe, and an `Advanced connection…` path that opens the existing `ConnectionDialog`.
- Keep Phase 3 CTA behavior honest before Phase 4: `Observe device output` may prefill/review a serial draft or open the existing connection dialog, but it must not display “journey completed”, first-signal milestones, xterm completion claims, human approval, J-Link/RTT download/observe flows, Pause, durable audit, or rollback promises.

## Scope Boundaries

This change does not implement Serial First Signal completion, `ObservationMonitor`, `firstSignal:*` IPC, xterm write-completion acknowledgement, Human Approval Broker, PreparedOperation/grants, approval continuation, Pause/Take Over, J-Link/firmware/RTT-specific readiness checks, durable JSONL audit/export/clear, remote approval, cloud services, telemetry, databases, or hardware rollback. Readiness checks must not connect to a device, reserve a port, write serial payloads, toggle control lines, reset, flash, start GDB/J-Link/RTT processes, install tooling, or mutate workspace/profile state without an explicit existing user action.

## Capabilities

### New Capabilities

- `runtime-readiness-start-center`: Defines the Phase 3 read-only readiness model, generation/event IPC bridge, display-safe device candidates, serial connection drafts, versioned preferences, Start Center UI, accessibility/i18n/performance requirements, and Phase 3 scope limits.

### Modified Capabilities

- Existing session, serial, control-profile, app-status/runbook, preload, and renderer app-shell capabilities may be adapted to consume the shared readiness provider and Start Center entry point. Existing advanced connection behavior, `SessionManager`, `Transport`, `WriteQueue`, `IJLinkBackend`, MCP handler authorization, Activity Center, and Operation Ledger contracts remain authoritative.

## Impact

- Expected new implementation areas:
  - `src/core/readiness/` for pure contracts, provider aggregation, candidate resolver, connection draft helpers, preferences adapter, and tests.
  - `src/shared/readiness-contract.ts` or equivalent strict shared DTO schemas.
  - `src/main/ipc/readiness-ipc.ts` and preload/mock additions for `window.linkterm.readiness`.
  - `src/renderer/features/readiness/` and/or `src/renderer/features/start-center/` for reducer/hydration/hooks/components.
  - Focused unit/component tests under `tests/unit/core/readiness`, `tests/unit/main/ipc`, `tests/unit/main/preload-*`, and `tests/unit/renderer`.
- Expected existing symbol seams that require fresh GitNexus upstream impact before implementation if edited:
  - Main/preload: `registerIpcHandlers`, `PreloadAPI`, `IPC_CHANNELS`, `api`, `createMockPreloadAPI`, `registerSerialIpc`, and any readiness IPC registrar.
  - Existing app-status/runbook extraction: `registerAgentRunbookTools`, `buildSerialStatus`, `buildRecommendedNextActions`, `buildRecommendedWorkflows`, and the runtime diagnostics provider seam if reused.
  - Renderer: `App`, `ConnectionDialog`, `SessionTabBar` or equivalent no-session shell, i18n exports `en`/`zh`, and any store/hook used for empty-state/session focus.
  - Workspace/profile: `ControlProfileRecordManager`, connection profile managers, and profile IPC only if reused for read-only summaries.
- Renderer receives only display-safe readiness DTOs and draft summaries. It must not receive raw workspace config, credentials, complete filesystem paths beyond approved aliases/basenames, raw serial errors/stacks, raw tool evidence, Main-only approval/lease/compensation objects, J-Link backend handles, firmware bytes, scripts, or terminal transcript.
- No new runtime dependency is expected. Any dependency for virtualization, preferences storage, or schema validation beyond current stack must be justified separately and pass license/dependency review before implementation.
