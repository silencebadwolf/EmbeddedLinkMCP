# Remove AI Pause/Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Remove the AI pause/takeover mechanism end-to-end so human and AI always share the same Main-owned queue, while preserving approval, audit, transcript, transport, and trust-boundary behavior.

**Architecture:** Keep one admission coordinator for serialized state-affecting calls and human-approval continuation, but remove its dependency on pause state, pause epochs, and `AiControlScope`. Delete the AI-control IPC/preload surface and renderer controls; MCP and Main paths continue to reach SessionManager, WriteQueue, Transport, and IJLinkBackend unchanged.

**Tech Stack:** TypeScript, Electron IPC/preload, React, Zustand-free local activity state, Vitest, ESLint, TypeScript build, GitNexus.

---

### Task 1: Make admission pause-free without weakening approval

**Files:**
- Modify: `src/core/ai-control/operation-admission-coordinator.ts`
- Modify: `src/mcp/registry.ts`
- Modify: `src/mcp/surfaces/terminal/tools.ts`
- Modify: `src/main/ipc/control-profile-ipc.ts`
- Modify: `src/mcp/server.ts`
- Test: `tests/unit/core/ai-control/operation-admission-coordinator.test.ts`
- Test: `tests/unit/mcp/registry.test.ts`
- Test: `tests/unit/mcp/terminal-tools.test.ts`
- Test: `tests/unit/main/ipc/control-profile-ipc.test.ts`

- [x] **Step 1: Run GitNexus upstream impact before editing admission symbols.**

  Run `impact({target: "OperationAdmissionCoordinator", direction: "upstream"})`, `impact({target: "registerTool", direction: "upstream"})`, and `impact({target: "withControlProfileAdmission", direction: "upstream"})`. Stop and report if any result is HIGH/CRITICAL.

- [x] **Step 2: Add failing regression tests.**

  In the coordinator test, pause the old fixture state and assert an AI state-affecting request still reaches its effectful callback. In registry and terminal tests, assert `write_to_session` and `send_and_wait` do not return `AI_CONTROL_PAUSED` when the persisted state is paused. In control-profile tests, assert approved continuation reaches the backend without the pause error.

- [x] **Step 3: Run the focused tests and verify they fail for the pause gate.**

  Run `pnpm vitest run tests/unit/core/ai-control/operation-admission-coordinator.test.ts tests/unit/mcp/registry.test.ts tests/unit/mcp/terminal-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts` and record the expected `AI_CONTROL_PAUSED` failures.

- [x] **Step 4: Remove pause checks while retaining admission serialization and approval.**

  Change `OperationAdmissionCoordinator` so it no longer imports `AiControlService`/`AiControlScope`, checks pause state, reports `blocked-by-pause`, or stores pause epochs. Keep its queue, `revalidate`, `consumeApproval`, and internal lease lifecycle. Remove `ToolDefinition.aiControlScope`, terminal `aiControlScope` declarations, registry pause-failure conversion, and control-profile pause error conversion. Keep `APPROVAL_REQUIRED` and existing transport/session errors unchanged.

- [x] **Step 5: Run focused tests and typecheck the changed modules.**

  Run the same Vitest command plus `pnpm exec tsc -p tsconfig.json --noEmit`. Expected: all updated tests pass and no pause-related type references remain in these modules.

### Task 2: Delete Main/preload/shared AI-control surface and persisted-state wiring

**Files:**
- Modify: `src/main/ipc/index.ts`
- Delete: `src/main/ipc/ai-control-ipc.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/shared/preload-api.ts`
- Modify: `src/shared/ipc-protocol.ts`
- Delete: `src/shared/ai-control-contract.ts`
- Delete: `src/core/ai-control/ai-control-service.ts`
- Delete: `src/core/ai-control/ai-control-state.ts`
- Delete: `src/core/ai-control/ai-control-store.ts`
- Modify: `src/core/ai-control/operation-admission-coordinator.ts` (move to `src/core/operation-admission/` if imports require a neutral boundary)
- Test: `tests/unit/main/ipc/ai-control-ipc.test.ts`
- Test: `tests/unit/main/preload-ai-control.test.ts`
- Test: `tests/unit/core/ai-control/ai-control-service.test.ts`
- Test: `tests/unit/core/ai-control/ai-control-state.test.ts`
- Test: `tests/unit/core/ai-control/ai-control-store.test.ts`

- [x] **Step 1: Run GitNexus impact before editing Main context, preload, and IPC symbols.**

  Run upstream impact for `registerIpcHandlers`, `registerAiControlIpc`, `aiControl`, and `AiControlService`. Report HIGH/CRITICAL before proceeding.

- [x] **Step 2: Add a failing integration assertion that a paused persisted file cannot block a fresh runtime.**

  Extend the Main/MCP harness to create a legacy `ai-control-state.json` with `global.paused=true`, boot the runtime, invoke a state-affecting terminal operation, and assert it reaches the existing approval/transport path rather than `AI_CONTROL_PAUSED`.

- [x] **Step 3: Run the focused Main/preload tests and confirm failure.**

  Run `pnpm vitest run tests/unit/main/ipc/ai-control-ipc.test.ts tests/unit/main/preload-ai-control.test.ts tests/unit/core/ai-control tests/integration/main-runtime-imports.test.ts`.

- [x] **Step 4: Remove runtime construction, registration, disposal, and returned context fields.**

  Delete `AiControlFileStore`/`AiControlService` initialization from `registerIpcHandlers`, remove `registerAiControlIpc` registration/rollback/disposal, and remove `aiControlService` from `MainProcessContext`. Keep the neutral admission coordinator and approval service wiring.

- [x] **Step 5: Remove IPC channels, preload schema helpers, and `PreloadAPI.aiControl`.**

  Delete AI-control channel constants and the `aiControl` object from `contextBridge`; remove imports and schemas so `window.linkterm` exposes sessions, activity, approval, readiness, first-signal, UI, and control-profile APIs only.

- [x] **Step 6: Delete obsolete service/store/contract tests and replace them with a no-legacy-state regression.**

  The replacement test must verify the legacy file is ignored (not rewritten or deleted) and that a fresh runtime has no pause state in its public context.

- [x] **Step 7: Run Main/preload integration tests and build.**

  Run `pnpm vitest run tests/unit/main tests/integration/main-runtime-imports.test.ts` and `pnpm run build:main`. Expected: no imports of `ai-control-contract`, `ai-control-store`, or `ai-control-ipc` remain outside deleted tests/files.

### Task 3: Remove renderer pause/takeover controls and preserve activity status

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/SessionTabBar.tsx`
- Modify: `src/renderer/features/activity/AiStatusCapsule.tsx`
- Delete: `src/renderer/features/ai-control/ai-control-reducer.ts`
- Delete: `src/renderer/features/ai-control/use-ai-control.ts`
- Modify: `src/renderer/i18n/zh.ts`
- Modify: `src/renderer/i18n/en.ts`
- Test: `tests/unit/renderer/components/SessionTabBar.test.tsx`
- Test: `tests/unit/renderer/activity/activity-components.test.tsx`
- Test: `tests/unit/renderer/App.test.tsx`
- Delete or replace: `tests/unit/renderer/ai-control/*`

- [x] **Step 1: Run GitNexus upstream impact before editing `App`, `SessionTabBar`, and `AiStatusCapsule`.**

  Run upstream impact for `App`, `SessionTabBar`, `AiStatusCapsule`, and `useAiControl`; report HIGH/CRITICAL before editing.

- [x] **Step 2: Add failing UI tests.**

  Assert the header and session tabs render no pause/resume/takeover controls or paused badge, while the activity capsule still renders approval/running/attention/idle states and opens Activity Center.

- [x] **Step 3: Run focused renderer tests and verify the old controls cause failure.**

  Run `pnpm vitest run tests/unit/renderer/components/SessionTabBar.test.tsx tests/unit/renderer/activity/activity-components.test.tsx tests/unit/renderer/App.test.tsx tests/unit/renderer/ai-control`.

- [x] **Step 4: Remove `useAiControl` subscription and callbacks from `App`.**

  Delete pause/takeover state, `requestGlobalPauseToggle`, `requestSessionTakeOver`, and all props passed to `SessionTabBar`. Keep `AiStatusCapsule` as an activity-only indicator.

- [x] **Step 5: Remove pause/takeover controls from `SessionTabBar`.**

  Delete pause badges/buttons and take-over button; keep tab selection, origin indicator, activity entry, close, and new-session controls. Clicking/focusing the terminal must not require an AI-control callback.

- [x] **Step 6: Make `AiStatusCapsule` activity-only and remove pause translations.**

  Remove `aiControlState` and `selectAnyAiPause`; status comes only from Activity Center state. Delete unused pause/takeover translation keys in both locales.

- [x] **Step 7: Run renderer tests, lint, and build.**

  Run `pnpm vitest run tests/unit/renderer`, `pnpm lint`, and `pnpm run build:renderer`. Expected: no visible pause/takeover copy remains and keyboard-write tests remain green.

### Task 4: Remove `AI_CONTROL_PAUSED` from MCP/error/activity surfaces

**Files:**
- Modify: `src/mcp/registry.ts`
- Modify: `src/shared/error-codes.ts`
- Modify: `src/mcp/surfaces/control-workflow/job-manager.ts`
- Modify: `src/renderer/features/activity/ActivityCenterDrawer.tsx`
- Modify: `src/renderer/features/activity/activity-reducer.ts`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`
- Test: `tests/unit/mcp/registry.test.ts`
- Test: `tests/unit/mcp/control-workflow-job-manager.test.ts`
- Test: `tests/unit/renderer/activity/activity-components.test.tsx`

- [x] **Step 1: Run GitNexus upstream impact for `ToolError`, `ActivityCenterDrawer`, and `activity-reducer`.**

- [x] **Step 2: Add failing assertions that `AI_CONTROL_PAUSED` is not a public error/status.**

  Existing historical activity records may still be loaded; assert they render as ordinary failed operations and never produce a pause badge or blocked-by-pause status.

- [x] **Step 3: Remove the error code and pause-specific activity branch.**

  Delete `AI_CONTROL_PAUSED` from shared error-code unions, registry normalization, job-manager terminal error unions, activity status formatting, and translations. Do not delete historical audit files.

- [x] **Step 4: Run MCP/activity tests.**

  Run `pnpm vitest run tests/unit/mcp tests/unit/renderer/activity` and confirm approval failures still use `APPROVAL_REQUIRED`.

### Task 5: Full verification and scope review

**Files:**
- Modify: `docs/engineering/` only if verification reveals stale pause/takeover documentation.

- [x] **Step 1: Search for stale mechanism references.**

  Run `rg -n "AiControl|aiControl|AI_CONTROL_PAUSED|pauseGlobal|pauseSession|takeOverSession|接管|暂停 AI|恢复 AI" src tests docs` and classify each remaining hit as historical documentation, approval terminology, or an accidental live reference. Remove accidental live references only after impact analysis.

- [x] **Step 2: Run the complete quality suite.**

  Run `pnpm lint`, `pnpm run build`, focused regression tests, `pnpm run validate:licenses`, and the configured coverage report. Record any pre-existing full-suite timeout separately; do not claim it passed if it did not complete.

- [x] **Step 3: Run GitNexus PDG/taint and `detect_changes`.**

  Run targeted upstream impact for every edited exported symbol, then `explain`/PDG queries for Main admission and session write paths, and `detect_changes({scope:"all"})`. Confirm only expected symbols/processes are affected.

- [x] **Step 4: Run verification-before-completion and report evidence.**

  Re-read this plan, verify every acceptance criterion, capture fresh test/build/lint evidence, and report that the mechanism—not merely its buttons—was removed. Do not commit, push, or create a PR.
