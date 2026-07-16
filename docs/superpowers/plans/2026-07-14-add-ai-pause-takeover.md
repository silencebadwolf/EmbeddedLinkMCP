# Add AI Pause Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this Codex session, execute inline unless the user explicitly authorizes sub-agents.

**Goal:** Deliver Phase 7 Pause / Take Over so LinkTerm can pause new AI state-affecting changes globally or per session, preserve human control, show honest stop controls, and keep authority in Main.

**Architecture:** Add a Main-owned AI control domain with display-safe shared DTOs, persisted pause latches, and an admission coordinator that serializes effect revalidation, pause checks, approval consume, and lease acquisition. Integrate it into existing MCP/direct approval, session write, job, IPC/preload, and renderer surfaces without bypassing `SessionManager`, `WriteQueue`, `Transport`, `IJLinkBackend`, `ControlWorkflowJobManager`, manager boundaries, or the Main trust boundary.

**Tech Stack:** TypeScript, Electron Main/preload IPC, React renderer, Vitest, Testing Library, OpenSpec, GitNexus impact/PDG/taint, pnpm quality scripts.

---

## Governance and safety rules for every task

- Before modifying any existing function, class, method, interface, component, shared schema, or exported object, run GitNexus upstream impact for the symbol and record direct callers, affected processes, and risk. Stop and report before editing if the result is HIGH or CRITICAL.
- Use TDD for behavior changes: write the failing test, run it to observe the expected failure, implement the smallest passing change, rerun the focused test.
- Do not commit, push, create PRs, reset the worktree, or clean untracked files unless the user explicitly authorizes it.
- Do not run real hardware side-effect operations: no flash, erase, reset, probe attach, GDB server, RTT server, serial payload write, mass erase, or hardware recovery command.
- Keep Phase 7 scoped to pause, take over, and capability-aware stop. Do not implement Phase 8 durable audit/export/clear.

## Phase 7 file map

Create:

- `src/shared/ai-control-contract.ts` — display-safe AI control DTOs, event/command result shapes, sanitizers, and bounded diagnostics.
- `src/core/ai-control/ai-control-state.ts` — pure pause state transitions and effective pause computation.
- `src/core/ai-control/ai-control-store.ts` — versioned JSON persistence adapter for Electron `userData`.
- `src/core/ai-control/ai-control-service.ts` — Main-owned pause/takeover service with revisions and subscriptions.
- `src/core/ai-control/operation-admission-coordinator.ts` — serialized AI admission and Main-only execution leases.
- `src/main/ipc/ai-control-ipc.ts` — narrow Main IPC handlers for snapshot, subscribe, pause/resume, and take over.
- `src/renderer/features/ai-control/ai-control-reducer.ts` — renderer-only state reducer that ignores stale revisions and bounds diagnostics.
- `src/renderer/features/ai-control/use-ai-control.ts` — hydration/subscription hook and UI action helpers.
- `tests/unit/shared/ai-control-contract.test.ts`
- `tests/unit/core/ai-control/ai-control-state.test.ts`
- `tests/unit/core/ai-control/ai-control-store.test.ts`
- `tests/unit/core/ai-control/ai-control-service.test.ts`
- `tests/unit/core/ai-control/operation-admission-coordinator.test.ts`
- `tests/unit/main/ipc/ai-control-ipc.test.ts`
- `tests/unit/main/preload-ai-control.test.ts`
- `tests/unit/renderer/ai-control/ai-control-reducer.test.ts`
- `tests/unit/renderer/ai-control/use-ai-control.test.tsx`

Modify only as needed after GitNexus impact:

- `src/shared/ipc-protocol.ts` — add AI control IPC channel constants.
- `src/shared/preload-api.ts` — add display-safe `aiControl` preload namespace.
- `src/main/preload.ts` — expose validated AI control APIs.
- `src/main/ipc/index.ts` — construct and register one shared `AiControlService` plus `OperationAdmissionCoordinator`.
- `src/mcp/registry.ts` and `src/mcp/approval-gate.ts` — integrate pause admission with MCP tool execution and approval consume order.
- `src/main/ipc/control-profile-approval-gate.ts` and `src/main/ipc/control-profile-ipc.ts` — integrate pause admission for direct continuation/start paths.
- `src/mcp/surfaces/terminal/tools.ts` — gate AI-origin terminal writes before `SessionManager.write`.
- `src/mcp/surfaces/control-workflow/job-manager.ts`, `src/mcp/surfaces/control-workflow/schemas.ts`, and `src/mcp/surfaces/control-workflow/tools.ts` — expose cancellation capability and distinct stop projections.
- `src/renderer/App.tsx`, `src/renderer/features/activity/AiStatusCapsule.tsx`, `src/renderer/features/activity/ActivityCenterDrawer.tsx`, `src/renderer/features/approval/ApprovalSheet.tsx`, `src/renderer/features/approval/approval-reducer.ts`, `src/renderer/components/SessionTabBar.tsx`, and `src/renderer/components/TerminalView.tsx` — add pause/takeover/stop presentation without authority transfer.
- `src/renderer/i18n/en.ts` and `src/renderer/i18n/zh.ts` — add bilingual strings.
- `tests/fixtures/mock-preload-api.ts` — add `aiControl` spies and event helpers.

## Task 1: Baseline gates and symbol impact ledger

**Files:**

- Read: `openspec/changes/add-ai-pause-takeover/proposal.md`
- Read: `openspec/changes/add-ai-pause-takeover/design.md`
- Read: `openspec/changes/add-ai-pause-takeover/tasks.md`
- Read: `openspec/changes/add-ai-pause-takeover/specs/ai-pause-takeover/spec.md`
- Modify: this plan only while recording evidence

- [ ] **Step 1: Re-run Phase 7 OpenSpec validation**

Run:

```powershell
pnpm exec openspec validate add-ai-pause-takeover --strict
```

Expected: `Change 'add-ai-pause-takeover' is valid`.

- [ ] **Step 2: Reconfirm dirty worktree without cleaning it**

Run:

```powershell
git status --short
```

Expected: cumulative Phase 0-6 changes plus `openspec/changes/add-ai-pause-takeover/`; do not reset or remove any file.

- [ ] **Step 3: Record upstream impact before editing first existing symbols**

Run GitNexus upstream impact for these symbols before editing them:

```json
[
  "IPC_CHANNELS",
  "PreloadAPI",
  "registerIpcHandlers",
  "createMcpApprovalGate",
  "registerTool",
  "createControlProfileApprovalGate",
  "registerControlProfileIpc",
  "SessionManager.write",
  "ControlWorkflowJobManager",
  "registerControlWorkflowTools",
  "AiStatusCapsule",
  "ActivityCenterDrawer",
  "ApprovalSheet",
  "SessionTabBar",
  "TerminalView",
  "createMockPreloadAPI"
]
```

Expected: every edited existing symbol has fresh upstream impact evidence; HIGH or CRITICAL results are reported before the edit.

## Task 2: Shared display-safe AI control contract

**Files:**

- Create: `src/shared/ai-control-contract.ts`
- Test: `tests/unit/shared/ai-control-contract.test.ts`

- [ ] **Step 1: Write failing DTO sanitization tests**

Add tests covering safe snapshot shape, bounded diagnostics, stale revision comparison, and authority leakage rejection:

```ts
import { describe, expect, it } from 'vitest';
import {
  AI_CONTROL_SCHEMA_VERSION,
  sanitizeAiControlEvent,
  sanitizeAiControlSnapshot,
} from '../../../src/shared/ai-control-contract';

describe('ai-control shared contract', () => {
  it('omits main-only authority fields from snapshots and events', () => {
    const unsafe = {
      schemaVersion: AI_CONTROL_SCHEMA_VERSION,
      revision: 4,
      global: { paused: true, changedAt: '2026-07-14T00:00:00.000Z', changedBy: 'human' },
      sessions: [{ sessionId: 's1', paused: true, changedAt: '2026-07-14T00:00:00.000Z', changedBy: 'human' }],
      leaseId: 'lease-secret',
      principalId: 'principal-secret',
      authorizationRecord: { id: 'auth-secret' },
      preparedOperation: { id: 'prepared-secret' },
      grant: { id: 'grant-secret' },
      effectFingerprint: 'fingerprint-secret',
      stack: 'stack-secret',
    };

    const snapshot = sanitizeAiControlSnapshot(unsafe);

    expect(snapshot).toEqual({
      schemaVersion: '1.0.0',
      revision: 4,
      global: { paused: true, changedAt: '2026-07-14T00:00:00.000Z', changedBy: 'human' },
      sessions: [{ sessionId: 's1', paused: true, changedAt: '2026-07-14T00:00:00.000Z', changedBy: 'human' }],
      diagnostics: [],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/lease-secret|principal-secret|prepared-secret|grant-secret|fingerprint-secret|stack-secret/);
  });

  it('returns bounded diagnostics for malformed events without retaining raw payloads', () => {
    const event = sanitizeAiControlEvent({ schemaVersion: 'bad', raw: { secret: 'do-not-retain' } });

    expect(event.kind).toBe('diagnostic');
    expect(JSON.stringify(event)).not.toContain('do-not-retain');
    expect(JSON.stringify(event).length).toBeLessThan(1024);
  });
});
```

- [ ] **Step 2: Run the shared contract test and confirm the expected failure**

Run:

```powershell
pnpm exec vitest run tests/unit/shared/ai-control-contract.test.ts
```

Expected: FAIL because `src/shared/ai-control-contract.ts` does not exist.

- [ ] **Step 3: Implement the shared contract**

Create exported types and sanitizers:

```ts
export const AI_CONTROL_SCHEMA_VERSION = '1.0.0' as const;
export type AiControlChangedBy = 'human' | 'system';
export type AiControlScope = { kind: 'global' } | { kind: 'session'; sessionId: string };
export type CancellationCapability = 'none' | 'best-effort' | 'safe-point';

export interface AiControlLatchView {
  readonly paused: boolean;
  readonly changedAt: string;
  readonly changedBy: AiControlChangedBy;
}

export interface AiControlSessionView extends AiControlLatchView {
  readonly sessionId: string;
}

export interface AiControlDiagnosticView {
  readonly code: 'malformed-event' | 'persistence-repaired' | 'persistence-failed';
  readonly message: string;
  readonly at: string;
}

export interface AiControlSnapshot {
  readonly schemaVersion: typeof AI_CONTROL_SCHEMA_VERSION;
  readonly revision: number;
  readonly global: AiControlLatchView;
  readonly sessions: readonly AiControlSessionView[];
  readonly diagnostics: readonly AiControlDiagnosticView[];
}

export type AiControlEvent =
  | { readonly kind: 'snapshot'; readonly snapshot: AiControlSnapshot }
  | { readonly kind: 'diagnostic'; readonly diagnostic: AiControlDiagnosticView };
```

Implement bounded string normalization, unknown-field dropping, and sorted session projection.

- [ ] **Step 4: Run the shared contract test and confirm it passes**

Run:

```powershell
pnpm exec vitest run tests/unit/shared/ai-control-contract.test.ts
```

Expected: PASS.

## Task 3: Pure pause state, persistence, and service

**Files:**

- Create: `src/core/ai-control/ai-control-state.ts`
- Create: `src/core/ai-control/ai-control-store.ts`
- Create: `src/core/ai-control/ai-control-service.ts`
- Test: `tests/unit/core/ai-control/ai-control-state.test.ts`
- Test: `tests/unit/core/ai-control/ai-control-store.test.ts`
- Test: `tests/unit/core/ai-control/ai-control-service.test.ts`

- [ ] **Step 1: Write failing state transition tests**

Cover OR semantics, idempotent repeated commands, global/session resume independence, and Take Over session-only behavior:

```ts
import { describe, expect, it } from 'vitest';
import {
  createInitialAiControlState,
  getEffectivePause,
  pauseGlobal,
  pauseSession,
  resumeGlobal,
  resumeSession,
  takeOverSession,
} from '../../../../src/core/ai-control/ai-control-state';

describe('ai control state', () => {
  it('uses OR semantics for session effective pause', () => {
    const state = pauseGlobal(createInitialAiControlState('2026-07-14T00:00:00.000Z'), '2026-07-14T00:00:01.000Z', 'human');
    const resumedSession = resumeSession(state, 's1', '2026-07-14T00:00:02.000Z', 'human');
    expect(getEffectivePause(resumedSession, { kind: 'session', sessionId: 's1' })).toBe(true);
  });

  it('global resume does not clear a session pause', () => {
    const state = pauseSession(createInitialAiControlState('2026-07-14T00:00:00.000Z'), 's1', '2026-07-14T00:00:01.000Z', 'human');
    const resumedGlobal = resumeGlobal(state, '2026-07-14T00:00:02.000Z', 'human');
    expect(getEffectivePause(resumedGlobal, { kind: 'session', sessionId: 's1' })).toBe(true);
  });

  it('take over pauses only the selected session', () => {
    const state = takeOverSession(createInitialAiControlState('2026-07-14T00:00:00.000Z'), 's1', '2026-07-14T00:00:01.000Z', 'human');
    expect(getEffectivePause(state, { kind: 'session', sessionId: 's1' })).toBe(true);
    expect(getEffectivePause(state, { kind: 'session', sessionId: 's2' })).toBe(false);
  });
});
```

- [ ] **Step 2: Write failing store/service tests**

Use temporary directories only:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { AiControlFileStore } from '../../../../src/core/ai-control/ai-control-store';
import { AiControlService } from '../../../../src/core/ai-control/ai-control-service';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('ai control persistence', () => {
  it('restores persisted pause state on restart', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'linkterm-ai-control-'));
    const store = new AiControlFileStore(tempDir);
    const service = await AiControlService.create({ store, now: () => '2026-07-14T00:00:00.000Z' });
    await service.pauseSession('s1', 'human');

    const restarted = await AiControlService.create({ store, now: () => '2026-07-14T00:00:01.000Z' });
    expect(restarted.isPaused({ kind: 'session', sessionId: 's1' })).toBe(true);
  });

  it('repairs corrupt persistence with a bounded diagnostic', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'linkterm-ai-control-'));
    await writeFile(join(tempDir, 'ai-control-state.json'), '{bad json with secret-token}', 'utf8');
    const service = await AiControlService.create({ store: new AiControlFileStore(tempDir), now: () => '2026-07-14T00:00:00.000Z' });

    const snapshot = service.getSnapshot();
    expect(snapshot.global.paused).toBe(false);
    expect(snapshot.sessions).toHaveLength(0);
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
    expect(snapshot.diagnostics[0]?.code).toBe('persistence-repaired');
  });
});
```

- [ ] **Step 3: Run tests and confirm expected failures**

Run:

```powershell
pnpm exec vitest run tests/unit/core/ai-control/ai-control-state.test.ts tests/unit/core/ai-control/ai-control-store.test.ts tests/unit/core/ai-control/ai-control-service.test.ts
```

Expected: FAIL because the core files do not exist.

- [ ] **Step 4: Implement core state, store, and service**

Implementation details:

- `AiControlState` stores internal epochs; `getSnapshot()` drops epochs.
- `pauseGlobal`, `resumeGlobal`, `pauseSession`, `resumeSession`, and `takeOverSession` are immutable pure transitions.
- Repeating a command that does not change a latch returns the same epoch.
- `AiControlFileStore` reads and writes `ai-control-state.json` under the provided `userData` path.
- Persistence failures surface `persistence-failed` in display-safe diagnostics while keeping in-memory state authoritative.
- `AiControlService.subscribe(listener)` returns an unsubscribe function and emits snapshots after state changes.

- [ ] **Step 5: Run tests and confirm they pass**

Run:

```powershell
pnpm exec vitest run tests/unit/core/ai-control/ai-control-state.test.ts tests/unit/core/ai-control/ai-control-store.test.ts tests/unit/core/ai-control/ai-control-service.test.ts
```

Expected: PASS.

## Task 4: Operation admission coordinator and Main-only leases

**Files:**

- Create: `src/core/ai-control/operation-admission-coordinator.ts`
- Test: `tests/unit/core/ai-control/operation-admission-coordinator.test.ts`

- [ ] **Step 1: Write failing admission tests**

Add tests proving serialized admission, pause race behavior, read-only/human/system allowance, and no authority DTO leakage:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AiControlService } from '../../../../src/core/ai-control/ai-control-service';
import { InMemoryAiControlStore } from '../../../../src/core/ai-control/ai-control-store';
import { OperationAdmissionCoordinator } from '../../../../src/core/ai-control/operation-admission-coordinator';

describe('operation admission coordinator', () => {
  it('blocks paused AI state-affecting operations before the effectful call', async () => {
    const service = await AiControlService.create({ store: new InMemoryAiControlStore(), now: () => '2026-07-14T00:00:00.000Z' });
    await service.pauseSession('s1', 'human');
    const coordinator = new OperationAdmissionCoordinator({ aiControl: service, runtimeId: 'runtime-1' });
    const effectful = vi.fn();

    const result = await coordinator.withAdmission({
      operationId: 'op-1',
      principalId: 'ai:test',
      origin: 'ai',
      mode: 'state-affecting',
      scope: { kind: 'session', sessionId: 's1' },
      revalidate: async () => ({ ok: true }),
      consumeApproval: async () => ({ ok: true }),
    }, async () => {
      effectful();
      return 'executed';
    });

    expect(result).toMatchObject({ ok: false, reason: 'blocked-by-pause' });
    expect(effectful).not.toHaveBeenCalled();
  });

  it('allows read-only AI and human operations while paused', async () => {
    const service = await AiControlService.create({ store: new InMemoryAiControlStore(), now: () => '2026-07-14T00:00:00.000Z' });
    await service.pauseGlobal('human');
    const coordinator = new OperationAdmissionCoordinator({ aiControl: service, runtimeId: 'runtime-1' });

    await expect(coordinator.withAdmission({
      operationId: 'read-1',
      principalId: 'ai:test',
      origin: 'ai',
      mode: 'read-only',
      scope: { kind: 'global' },
      revalidate: async () => ({ ok: true }),
    }, async () => 'read')).resolves.toMatchObject({ ok: true, value: 'read' });

    await expect(coordinator.withAdmission({
      operationId: 'human-1',
      principalId: 'human:test',
      origin: 'human',
      mode: 'state-affecting',
      scope: { kind: 'global' },
      revalidate: async () => ({ ok: true }),
    }, async () => 'human')).resolves.toMatchObject({ ok: true, value: 'human' });
  });
});
```

- [ ] **Step 2: Run test and confirm expected failure**

Run:

```powershell
pnpm exec vitest run tests/unit/core/ai-control/operation-admission-coordinator.test.ts
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement admission coordinator**

Implementation details:

- Serialize admission with an internal promise queue.
- For AI `state-affecting`, `disruptive`, and `destructive-or-unknown` modes: call `revalidate`, check effective pause, consume approval if supplied, acquire a Main-only `ExecutionAdmissionLease`, invoke the effectful callback, then release in `finally`.
- For read-only AI and human/system origins: call `revalidate` and the callback without pause blocking.
- Return a display-safe blocked result that includes scope and snapshot revision, not lease id, principal, epochs, authorization records, or fingerprints.
- `releaseLease(lease)` is idempotent; `restartRuntime(newRuntimeId)` clears active leases.

- [ ] **Step 4: Run test and confirm it passes**

Run:

```powershell
pnpm exec vitest run tests/unit/core/ai-control/operation-admission-coordinator.test.ts
```

Expected: PASS.

## Task 5: Main IPC, preload, and fixture bridge

**Files:**

- Modify after impact: `src/shared/ipc-protocol.ts`
- Modify after impact: `src/shared/preload-api.ts`
- Modify after impact: `src/main/preload.ts`
- Modify after impact: `src/main/ipc/index.ts`
- Create: `src/main/ipc/ai-control-ipc.ts`
- Modify after impact: `tests/fixtures/mock-preload-api.ts`
- Test: `tests/unit/main/ipc/ai-control-ipc.test.ts`
- Test: `tests/unit/main/preload-ai-control.test.ts`
- Test: `tests/unit/fixtures/mock-preload-api.test.ts`

- [ ] **Step 1: Run GitNexus impact for IPC/preload symbols**

Run upstream impact for `IPC_CHANNELS`, `PreloadAPI`, `api`, `registerIpcHandlers`, and `createMockPreloadAPI`.

Expected: impact recorded; HIGH/CRITICAL reported before edits.

- [ ] **Step 2: Write failing IPC/preload tests**

Test snapshot, subscribe-before-hydrate ordering, pause/resume/takeover commands, display-safe results, and malformed-event handling:

```ts
import { describe, expect, it, vi } from 'vitest';
import { registerAiControlIpc } from '../../../../src/main/ipc/ai-control-ipc';
import { AiControlService } from '../../../../src/core/ai-control/ai-control-service';
import { InMemoryAiControlStore } from '../../../../src/core/ai-control/ai-control-store';

describe('ai control ipc', () => {
  it('returns display-safe snapshots and executes pause commands in Main', async () => {
    const service = await AiControlService.create({ store: new InMemoryAiControlStore(), now: () => '2026-07-14T00:00:00.000Z' });
    const ipcMain = createFakeIpcMain();
    registerAiControlIpc({ ipcMain, aiControl: service });

    const result = await ipcMain.invoke('aiControl:pauseSession', { senderFrame: {} }, { sessionId: 's1' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/leaseId|principalId|authorizationRecord|preparedOperation|grant/);
    expect(service.isPaused({ kind: 'session', sessionId: 's1' })).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests and confirm expected failures**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/ai-control-ipc.test.ts tests/unit/main/preload-ai-control.test.ts tests/unit/fixtures/mock-preload-api.test.ts
```

Expected: FAIL because channels, preload namespace, and fixture helpers do not exist.

- [ ] **Step 4: Implement IPC/preload bridge**

Implementation details:

- Add `IPC_CHANNELS.aiControl.snapshot`, `subscribe`, `pauseGlobal`, `resumeGlobal`, `pauseSession`, `resumeSession`, `takeOverSession`, and `event`.
- Add `PreloadAPI.aiControl` methods:
  - `getSnapshot(): Promise<AiControlSnapshot>`
  - `subscribe(listener: (event: AiControlEvent) => void): () => void`
  - `pauseGlobal(): Promise<AiControlCommandResult>`
  - `resumeGlobal(): Promise<AiControlCommandResult>`
  - `pauseSession(sessionId: string): Promise<AiControlCommandResult>`
  - `resumeSession(sessionId: string): Promise<AiControlCommandResult>`
  - `takeOverSession(sessionId: string): Promise<AiControlCommandResult>`
- In preload, validate `sessionId` as a non-empty string and sanitize all inbound events before listener delivery.
- In `registerIpcHandlers`, create one `AiControlService` from `app.getPath('userData')`, create one `OperationAdmissionCoordinator`, and pass both through existing dependency wiring.

- [ ] **Step 5: Run tests and confirm they pass**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/ai-control-ipc.test.ts tests/unit/main/preload-ai-control.test.ts tests/unit/fixtures/mock-preload-api.test.ts
```

Expected: PASS.

## Task 6: Approval and MCP admission integration

**Files:**

- Modify after impact: `src/mcp/registry.ts`
- Modify after impact: `src/mcp/approval-gate.ts`
- Modify after impact: `src/main/ipc/control-profile-approval-gate.ts`
- Modify after impact: `src/main/ipc/control-profile-ipc.ts`
- Test: `tests/unit/mcp/registry.test.ts`
- Test: `tests/unit/mcp/terminal-tools.test.ts`
- Test: `tests/unit/main/ipc/control-profile-approval-gate.test.ts`
- Test: `tests/unit/main/ipc/control-profile-ipc.test.ts`
- Test: `tests/integration/human-approval-mcp.test.ts`

- [ ] **Step 1: Run GitNexus impact for approval/admission seams**

Run upstream impact for `registerTool`, `createMcpApprovalGate`, `createControlProfileApprovalGate`, and `registerControlProfileIpc`.

Expected: impact recorded; HIGH/CRITICAL reported before edits.

- [ ] **Step 2: Write failing tests for pause before approval consume and backend call**

Add cases:

- MCP state-affecting tool with effective pause returns blocked-by-pause and does not call handler.
- Approved direct continuation while paused records approved-paused state and does not consume a grant or start backend work.
- Resume continuation revalidates effect/principal/surface/mode/expiry before admission.
- Grant expired while paused returns expired/not executed.
- Wrong consumer behavior still preserves the correct grant.

Representative assertion:

```ts
expect(effectfulBackendSpy).not.toHaveBeenCalled();
expect(result).toMatchObject({ ok: false, reason: 'blocked-by-pause' });
expect(JSON.stringify(result)).not.toMatch(/leaseId|principalId|authorizationRecord|preparedOperation|grant/);
```

- [ ] **Step 3: Run focused tests and confirm expected failures**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts tests/unit/main/ipc/control-profile-approval-gate.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/integration/human-approval-mcp.test.ts
```

Expected: FAIL for missing pause/admission behavior.

- [ ] **Step 4: Integrate coordinator without weakening Main authority**

Implementation details:

- Pass `OperationAdmissionCoordinator` as an optional dependency into MCP and direct approval paths.
- Classify tool operation mode from existing risk inventory/risk metadata:
  - read-only tools remain allowed while paused.
  - state-affecting, disruptive, and destructive-or-unknown AI tools require admission.
- Keep `PreparedOperation`, grants, `AuthorizationRecord`, `CallerPrincipalId`, effect fingerprint, and leases inside Main/MCP runtime memory.
- Ensure approval decision remains decision-only; consume grant inside coordinator after pause recheck and effect revalidation.
- Return display-safe `blocked-by-pause` and `approved-paused` projections.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts tests/unit/main/ipc/control-profile-approval-gate.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/integration/human-approval-mcp.test.ts
```

Expected: PASS.

## Task 7: AI-origin terminal writes and Take Over

**Files:**

- Modify after impact: `src/mcp/surfaces/terminal/tools.ts`
- Modify after impact: `src/core/session/session-manager.ts` only if no narrower seam is sufficient
- Modify after impact: `src/main/ipc/session-ipc.ts` only if Take Over focus needs a session event
- Modify after impact: `src/renderer/components/TerminalView.tsx`
- Modify after impact: `src/renderer/components/SessionTabBar.tsx`
- Test: `tests/unit/mcp/terminal-tools.test.ts`
- Test: `tests/unit/main/ipc/session-create.test.ts`
- Test: `tests/unit/renderer/components/TerminalView.test.tsx`
- Test: `tests/unit/renderer/components/SessionTabBar.test.tsx`

- [ ] **Step 1: Run GitNexus impact for session/write/takeover seams**

Run upstream impact for `SessionManager.write`, `write_to_session`, `send_and_wait`, `registerSessionIpc`, `TerminalView`, and `SessionTabBar`.

Expected: impact recorded; HIGH/CRITICAL reported before edits.

- [ ] **Step 2: Write failing tests for AI write blocking and human high lane preservation**

Add tests proving:

- paused AI `write_to_session` rejects before `SessionManager.write` or `WriteQueue.enqueue`.
- paused AI `send_and_wait` rejects before payload write.
- human `session:write` with `priority: 'high'` remains allowed.
- system-origin writes remain allowed through existing validation.

Representative assertions:

```ts
expect(sessionManager.write).not.toHaveBeenCalledWith('s1', expect.anything(), expect.objectContaining({ origin: 'ai' }));
expect(humanWriteResult.ok).toBe(true);
```

- [ ] **Step 3: Write failing Take Over UI tests**

Add tests proving Take Over:

- calls `preload.aiControl.takeOverSession(activeSessionId)`.
- focuses the mounted terminal input after successful command.
- does not call `session.write`, append synthetic device data, close the session, or create a new session.
- shows copy that says new AI changes are paused and human input remains available.

- [ ] **Step 4: Run tests and confirm expected failures**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/terminal-tools.test.ts tests/unit/renderer/components/TerminalView.test.tsx tests/unit/renderer/components/SessionTabBar.test.tsx
```

Expected: FAIL for missing pause gate and Take Over UI.

- [ ] **Step 5: Implement write admission and Take Over**

Implementation details:

- Prefer gating in MCP terminal tools before calling `SessionManager.write`, keeping `SessionManager` as the authoritative write path for actual writes.
- If a central session write hook is required, add an optional admission dependency to `SessionManager.write` without changing human/system behavior.
- Add renderer Take Over control for the active session that calls preload, focuses the existing terminal, and displays bounded human-control copy.
- Keep global pause unchanged during Take Over.

- [ ] **Step 6: Run tests and confirm they pass**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/terminal-tools.test.ts tests/unit/renderer/components/TerminalView.test.tsx tests/unit/renderer/components/SessionTabBar.test.tsx
```

Expected: PASS.

## Task 8: Capability-aware stop and running-operation projections

**Files:**

- Modify after impact: `src/mcp/surfaces/control-workflow/job-manager.ts`
- Modify after impact: `src/mcp/surfaces/control-workflow/schemas.ts`
- Modify after impact: `src/mcp/surfaces/control-workflow/tools.ts`
- Modify after impact: `src/renderer/features/activity/ActivityCenterDrawer.tsx`
- Test: `tests/unit/mcp/control-workflow-job-manager.test.ts`
- Test: `tests/unit/mcp/control-workflow-tools.test.ts`
- Test: `tests/unit/renderer/activity/activity-components.test.tsx`

- [ ] **Step 1: Run GitNexus impact for job/stop seams**

Run upstream impact for `ControlWorkflowJobManager`, `registerControlWorkflowTools`, `cancel_control_workflow_job`, and `ActivityCenterDrawer`.

Expected: impact recorded; HIGH/CRITICAL reported before edits.

- [ ] **Step 2: Write failing job and UI tests**

Add cases:

- running job declares `cancellationCapability: 'safe-point'` and UI shows `Stop at safe point`.
- running job declares `cancellationCapability: 'best-effort'` and UI shows `Request stop (best effort)`.
- running job declares `cancellationCapability: 'none'` and UI shows no stop button.
- stop-requested, cancelled, failed-after-stop-request, and succeeded-after-stop-request remain distinct.
- no UI copy contains rollback, undo, restored firmware, or guaranteed hardware state promises.

- [ ] **Step 3: Run tests and confirm expected failures**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/renderer/activity/activity-components.test.tsx
```

Expected: FAIL for missing capability projection/copy.

- [ ] **Step 4: Implement capability-aware stop projection**

Implementation details:

- Add `CancellationCapability` to job snapshots and activity DTOs.
- Use existing job manager cancellation path; do not add shell, SEGGER, reset, flash, RTT, or GDB calls.
- Set default capability to `best-effort` only for existing jobs that already support `cancel()`.
- Preserve `cancelRequested` and add final outcome projection text without collapsing status.

- [ ] **Step 5: Run tests and confirm they pass**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/renderer/activity/activity-components.test.tsx
```

Expected: PASS.

## Task 9: Renderer pause state, approval sheet, activity center, and i18n

**Files:**

- Create: `src/renderer/features/ai-control/ai-control-reducer.ts`
- Create: `src/renderer/features/ai-control/use-ai-control.ts`
- Modify after impact: `src/renderer/App.tsx`
- Modify after impact: `src/renderer/features/activity/AiStatusCapsule.tsx`
- Modify after impact: `src/renderer/features/activity/ActivityCenterDrawer.tsx`
- Modify after impact: `src/renderer/features/approval/approval-reducer.ts`
- Modify after impact: `src/renderer/features/approval/ApprovalSheet.tsx`
- Modify after impact: `src/renderer/i18n/en.ts`
- Modify after impact: `src/renderer/i18n/zh.ts`
- Test: `tests/unit/renderer/ai-control/ai-control-reducer.test.ts`
- Test: `tests/unit/renderer/ai-control/use-ai-control.test.tsx`
- Test: `tests/unit/renderer/activity/activity-components.test.tsx`
- Test: `tests/unit/renderer/approval/approval-sheet.test.tsx`
- Test: `tests/unit/renderer/App.test.tsx`

- [ ] **Step 1: Run GitNexus impact for renderer symbols**

Run upstream impact for `App`, `AiStatusCapsule`, `ActivityCenterDrawer`, `approvalReducer`, `ApprovalSheet`, `en`, and `zh`.

Expected: impact recorded; HIGH/CRITICAL reported before edits.

- [ ] **Step 2: Write failing reducer/hook/component tests**

Add cases:

- listener is registered before snapshot hydration.
- stale revisions are ignored.
- malformed events create bounded local diagnostics without retaining raw payload.
- paused status has independent capsule priority while approvals/running/attention remain visible as badges.
- Approval Sheet distinguishes `Approved · paused` from `Approved · ready to continue`.
- Activity Center shows blocked-by-pause and running-with-lease as display-safe states.
- EN/ZH contain all new keys used by components.

- [ ] **Step 3: Run tests and confirm expected failures**

Run:

```powershell
pnpm exec vitest run tests/unit/renderer/ai-control tests/unit/renderer/activity tests/unit/renderer/approval tests/unit/renderer/App.test.tsx
```

Expected: FAIL for missing reducer, hook, and UI copy.

- [ ] **Step 4: Implement renderer state and UI**

Implementation details:

- `useAiControl` subscribes first, then calls `getSnapshot`.
- Reducer compares `snapshot.revision`; older snapshots/events are ignored.
- Capsule shows paused state first, with secondary badges for approval/running/attention.
- Approval continue button shows disabled reason when approved-but-paused.
- Activity cards show blocked-by-pause, approved-paused, running-with-lease, and stop-requested without internal identifiers.
- All text flows through `en.ts` and `zh.ts`.

- [ ] **Step 5: Run tests and confirm they pass**

Run:

```powershell
pnpm exec vitest run tests/unit/renderer/ai-control tests/unit/renderer/activity tests/unit/renderer/approval tests/unit/renderer/App.test.tsx
```

Expected: PASS.

## Task 10: Accessibility, performance, and scope guards

**Files:**

- Modify or add tests under `tests/unit/renderer/`
- Modify or add tests under `tests/unit/shared/`
- Modify or add tests under `tests/unit/mcp/`

- [ ] **Step 1: Add failing accessibility tests**

Assert:

- Pause/Resume/Take Over controls are reachable by keyboard.
- Accessible names are distinct for global pause, global resume, session pause, session resume, Take Over, and stop.
- Paused state is not color-only.
- Focus returns to invoking control or terminal target after command completion.
- Reduced-motion mode does not depend on animation for status comprehension.

- [ ] **Step 2: Add failing bounded rendering tests**

Assert:

- Many paused sessions render within the existing bounded list policy.
- High-frequency read-only activity while paused does not make the AI capsule flicker between idle/running.
- Diagnostics are capped and trimmed.

- [ ] **Step 3: Add failing scope-guard tests**

Assert project diff and exported strings do not introduce:

- durable JSONL audit writer, audit export, audit clear, retention enforcement;
- database/cloud/telemetry service;
- generic chat UI;
- external installer;
- rollback, undo, restored firmware, guaranteed stop, or guaranteed hardware state wording;
- new flash, erase, reset, probe attach, GDB server, RTT server, or serial payload side-effect path.

- [ ] **Step 4: Run guard tests and confirm expected failures before implementation**

Run:

```powershell
pnpm exec vitest run tests/unit/renderer tests/unit/shared tests/unit/mcp
```

Expected: FAIL until missing a11y/performance/scope behavior is implemented.

- [ ] **Step 5: Implement missing a11y/performance/scope behavior**

Implementation details:

- Use semantic buttons with clear `aria-label`.
- Do not rely on color alone; include visible text or badge text.
- Trim diagnostics to the shared bounded limit.
- Avoid animation-only status transitions.
- Remove any forbidden wording or out-of-scope API found by the guard tests.

- [ ] **Step 6: Run guard tests and confirm they pass**

Run:

```powershell
pnpm exec vitest run tests/unit/renderer tests/unit/shared tests/unit/mcp
```

Expected: PASS for Phase 7 guard coverage.

## Task 11: Full validation, review, GitNexus closeout, and Phase 8 gate

**Files:**

- Modify: `openspec/changes/add-ai-pause-takeover/tasks.md` after implementation evidence is available
- Modify or create: Phase 7 evidence note only if the project already uses such notes for previous phases

- [ ] **Step 1: Run OpenSpec validation**

Run:

```powershell
pnpm exec openspec validate add-ai-pause-takeover --strict
pnpm exec openspec validate --all --strict
```

Expected: both PASS.

- [ ] **Step 2: Run focused Phase 7 tests**

Run:

```powershell
pnpm exec vitest run tests/unit/shared/ai-control-contract.test.ts tests/unit/core/ai-control tests/unit/main/ipc/ai-control-ipc.test.ts tests/unit/main/preload-ai-control.test.ts tests/unit/renderer/ai-control
pnpm exec vitest run tests/unit/mcp/terminal-tools.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts
pnpm exec vitest run tests/unit/renderer/activity tests/unit/renderer/approval tests/unit/renderer/App.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run Phase 1-6 regression slices**

Run:

```powershell
pnpm exec vitest run tests/unit/renderer/readiness tests/unit/renderer/first-success tests/unit/renderer/activity tests/unit/renderer/approval
pnpm exec vitest run tests/unit/mcp/runtime-control-tools.test.ts tests/unit/mcp/agent-runbook.test.ts tests/unit/mcp/control-workflow-tools.test.ts
pnpm exec vitest run tests/integration/human-approval-mcp.test.ts tests/integration/operation-ledger-mcp.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run quality gates**

Run:

```powershell
pnpm run lint
pnpm run build
pnpm run test
pnpm run test:coverage
pnpm run validate:licenses
pnpm audit --prod
git diff --check
```

Expected: PASS or documented non-Phase-7 external advisory for audit; no whitespace errors.

- [ ] **Step 5: Request and process code review**

Ask for Phase 7 code/security and requirements/UI-accessibility review. For each valid finding:

- write or update a failing test;
- implement the minimal correction;
- rerun the affected focused test;
- note the review finding and evidence in Phase 7 closeout.

- [ ] **Step 6: Run completion gates**

Run:

```powershell
pnpm exec openspec validate add-ai-pause-takeover --strict
pnpm exec openspec validate --all --strict
git diff --check
```

Then run GitNexus:

```json
{
  "directedPdgTaintTargets": [
    "src/core/ai-control/operation-admission-coordinator.ts",
    "src/mcp/approval-gate.ts",
    "src/main/ipc/control-profile-approval-gate.ts",
    "src/mcp/surfaces/terminal/tools.ts",
    "src/mcp/surfaces/control-workflow/job-manager.ts",
    "src/main/preload.ts",
    "src/renderer/features/ai-control/use-ai-control.ts"
  ],
  "detectChanges": { "scope": "compare", "base_ref": "main" }
}
```

Expected: directed review has no unresolved Phase 7 HIGH/CRITICAL issue; `detect_changes` scope is explained against the cumulative Phase 0-7 dirty tree.

- [ ] **Step 7: Update OpenSpec task evidence and stop before Phase 8**

Mark completed Phase 7 tasks with evidence in `openspec/changes/add-ai-pause-takeover/tasks.md`. Final report must state:

- Phase 7 is complete only if all Phase 7 evidence is fresh.
- A+D is not complete because Phase 8 Durable Audit remains.
- Explicit user authorization is required before entering Phase 8.
