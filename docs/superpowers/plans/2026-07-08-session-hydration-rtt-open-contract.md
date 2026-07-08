# Session Hydration RTT Open Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent periodic session reconciliation from stealing the active tab, and reject ambiguous RTT log open requests that provide both `probeId` and `root`.

**Architecture:** Keep changes inside the existing renderer hydration hook and main-process RTT open request normalizer. Do not narrow the shared `RttLogOpenRequestPayload` type in this slice because GitNexus impact analysis reports HIGH risk for that interface; enforce the contract at the IPC/runtime boundary instead.

**Tech Stack:** TypeScript, React hook tests with Vitest and happy-dom, Electron IPC handler tests with Vitest, GitNexus impact and change detection.

---

## GitNexus Pre-Change Evidence

- `impact(useSessionHydration, upstream)`: LOW risk; 1 direct caller (`src/renderer/App.tsx`), 1 affected process/module.
- `impact(normalizeRttLogOpenRequest, upstream)`: LOW risk; 1 direct caller (`openRttLogFromRequest`), affected processes include `registerRttLogSessionIpc` and `registerConnectionProfilesIpc`.
- `impact(RttLogOpenRequestPayload, upstream)`: HIGH risk; 27 direct imports and 72 impacted symbols. This plan explicitly avoids editing `src/shared/preload-api.ts` unless a later, separate type-contract migration is approved.

## File Structure

- Modify: `tests/unit/renderer/hooks/useSessionHydration.test.ts`
  - Adds regression coverage for periodic reconciliation after a user switches away from an already-known AI-created session.
- Modify: `src/renderer/hooks/useSessionHydration.ts`
  - Changes snapshot hydration so only newly discovered AI-created sessions are auto-selected.
- Modify: `tests/unit/main/ipc/rtt-log-session-ipc.test.ts`
  - Adds regression coverage for an ambiguous RTT open request that includes both `probeId` and `root`.
- Modify: `src/main/ipc/rtt-log-open-helper.ts`
  - Rejects requests that include both normalized target selectors before profile resolution or J-Link backend work begins.

## Non-Goals

- Do not edit `src/shared/preload-api.ts` in this pass.
- Do not refactor app-store active-session semantics.
- Do not change MCP schema behavior, which already models `probeId` and `root` as mutually exclusive.
- Do not alter manual UI RTT open payloads from `ConnectionDialog` or `ControlProfilePanel`.

---

### Task 1: Stop Polling From Reactivating Known AI Sessions

**Files:**
- Modify: `tests/unit/renderer/hooks/useSessionHydration.test.ts`
- Modify: `src/renderer/hooks/useSessionHydration.ts`

- [ ] **Step 1: Write the failing regression test**

Append this test inside the existing `describe('useSessionHydration', ...)` block:

```ts
  it('does not reactivate an already-known AI-created session during periodic reconciliation', async () => {
    vi.useFakeTimers();
    mock.spies.session.list
      .mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [
            {
              sessionId: 'sess_ai_rtt',
              label: 'RTT ch0',
              connectionType: 'rtt-log',
              state: 'open',
              createdBy: 'ai',
              rttLog: { probeId: 'probe-1', channelIndex: 0 },
            },
            {
              sessionId: 'sess_manual_serial',
              label: 'COM6',
              connectionType: 'serial',
              state: 'open',
            },
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [
            {
              sessionId: 'sess_ai_rtt',
              label: 'RTT ch0',
              connectionType: 'rtt-log',
              state: 'open',
              createdBy: 'ai',
              rttLog: { probeId: 'probe-1', channelIndex: 0 },
            },
            {
              sessionId: 'sess_manual_serial',
              label: 'COM6',
              connectionType: 'serial',
              state: 'open',
            },
          ],
        },
      } as never);

    const { useSessionHydration } = await import(
      '../../../../src/renderer/hooks/useSessionHydration.js'
    );

    renderHook(() => useSessionHydration());

    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().activeSessionId).toBe('sess_ai_rtt');

    act(() => {
      useAppStore.getState().setActive('sess_manual_serial');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(useAppStore.getState().activeSessionId).toBe('sess_manual_serial');
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm test -- tests/unit/renderer/hooks/useSessionHydration.test.ts
```

Expected: FAIL with an assertion showing `activeSessionId` is `sess_ai_rtt` instead of `sess_manual_serial`.

- [ ] **Step 3: Write the minimal implementation**

In `src/renderer/hooks/useSessionHydration.ts`, read store state inside `hydrate()` before each upsert and auto-select only AI sessions that were absent before this snapshot item was applied:

```ts
      for (const summary of result.data.sessions) {
        const isKnownSession = useAppStore.getState().sessions.has(summary.sessionId);
        upsertSummary(summary);
        if (!isKnownSession && summary.createdBy === 'ai') {
          setActive(summary.sessionId);
        }
      }
```

Keep lifecycle `created` handling unchanged:

```ts
        if (event.type === 'created' && event.session.createdBy === 'ai') {
          setActive(event.session.sessionId);
        }
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm test -- tests/unit/renderer/hooks/useSessionHydration.test.ts
```

Expected: PASS for all tests in `useSessionHydration.test.ts`.

---

### Task 2: Reject Ambiguous RTT Log Open Requests

**Files:**
- Modify: `tests/unit/main/ipc/rtt-log-session-ipc.test.ts`
- Modify: `src/main/ipc/rtt-log-open-helper.ts`

- [ ] **Step 1: Write the failing regression test**

Append this test before `it('returns a structured failure for invalid RTT log open input', ...)`:

```ts
  it('rejects RTT log open input that includes both probeId and root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-rtt-ipc-mutual-'));
    try {
      const sessionManager = new SessionManager();
      const backend = new FakeJLinkBackend();
      const controlProfileManager = new ControlProfileManager();
      await controlProfileManager.init(root, {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        rtt: { enabled: true },
      } as Parameters<ControlProfileManager['init']>[1]);
      registerRttLogSessionIpc(sessionManager, backend, controlProfileManager);
      const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;

      const result = await handler(undefined, {
        probeId: 'probe-existing',
        root,
        channelIndex: 0,
      });

      expect(result).toMatchObject({
        success: false,
        error: {
          code: 'INVALID_ARGUMENT',
        },
      });
      expect(backend.callsOf('probeConnect')).toEqual([]);
      expect(backend.callsOf('rttConnect')).toEqual([]);
      expect(sessionManager.listSummaries()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm test -- tests/unit/main/ipc/rtt-log-session-ipc.test.ts
```

Expected: FAIL because the handler currently accepts both fields, prefers `root`, and calls the backend.

- [ ] **Step 3: Write the minimal implementation**

In `src/main/ipc/rtt-log-open-helper.ts`, add this guard after the existing missing-target guard in `normalizeRttLogOpenRequest()`:

```ts
  if (probeId && root) {
    throw new InvalidRttLogOpenRequestError('probeId and root are mutually exclusive');
  }
```

The resulting target validation block should read:

```ts
  if (!probeId && !root) {
    throw new InvalidRttLogOpenRequestError('probeId or root is required');
  }
  if (probeId && root) {
    throw new InvalidRttLogOpenRequestError('probeId and root are mutually exclusive');
  }
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm test -- tests/unit/main/ipc/rtt-log-session-ipc.test.ts
```

Expected: PASS for all tests in `rtt-log-session-ipc.test.ts`.

---

### Task 3: Full Verification and Commit

**Files:**
- Inspect: `git diff -- tests/unit/renderer/hooks/useSessionHydration.test.ts src/renderer/hooks/useSessionHydration.ts tests/unit/main/ipc/rtt-log-session-ipc.test.ts src/main/ipc/rtt-log-open-helper.ts docs/superpowers/plans/2026-07-08-session-hydration-rtt-open-contract.md`

- [ ] **Step 1: Run build**

Run:

```powershell
pnpm run build
```

Expected: exit code 0.

- [ ] **Step 2: Run lint**

Run:

```powershell
pnpm run lint
```

Expected: exit code 0.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
pnpm test
```

Expected: exit code 0 with all test files passing.

- [ ] **Step 4: Run GitNexus change detection**

Run GitNexus:

```ts
detect_changes({ repo: 'link-mcp', scope: 'all' })
```

Expected: changed symbols are limited to the two implementation files plus tests/docs; affected flows align with pre-change impact (`App`, `registerRttLogSessionIpc`, and `registerConnectionProfilesIpc`).

- [ ] **Step 5: Commit the focused fix**

Stage only the planned files:

```powershell
git add --chmod=-x -- docs/superpowers/plans/2026-07-08-session-hydration-rtt-open-contract.md tests/unit/renderer/hooks/useSessionHydration.test.ts src/renderer/hooks/useSessionHydration.ts tests/unit/main/ipc/rtt-log-session-ipc.test.ts src/main/ipc/rtt-log-open-helper.ts
git diff --cached --check
git diff --cached --summary
git commit -m "fix: 修正 RTT 会话水合与打开契约"
```

Expected: commit succeeds with only the five planned files.

- [ ] **Step 6: Post-commit status**

Run:

```powershell
git status --short --branch
git show --stat --summary --oneline HEAD
```

Expected: branch is ahead of `origin/main` by 2 commits, and working tree is clean.

## Self-Review Checklist

- The periodic reconcile behavior is covered by a failing test before production code changes.
- Newly discovered AI-created sessions from polling still become active.
- Lifecycle `created` events from AI still become active immediately.
- Ambiguous RTT open input fails before `prepareProfileRttLogTarget`, `probeConnect`, or `rttConnect`.
- Shared preload API type remains unchanged because its GitNexus impact is HIGH.
- `detect_changes()` runs before the fix commit.
