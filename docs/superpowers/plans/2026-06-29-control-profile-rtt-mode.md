# Control Profile RTT Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.linkterm/control-profile.json` model serial terminal and RTT log as mutually exclusive observation modes, and let RTT log opening auto-resolve probe/channel from the workspace control profile.

**Architecture:** Keep the persisted profile backward-compatible by preserving `serial?` and `rtt?`, but reject profiles where both are enabled. Renderer saves either `serial.enabled=true` or `rtt.enabled=true`, never both. `rttLog.open` keeps the old `probeId` path and adds a `root` path that loads the control profile, connects J-Link from `jlink`, runs `rttConnect`, selects an up channel, then opens the RTT log session.

**Tech Stack:** TypeScript, React, Electron IPC, Zod, Vitest.

---

### Task 1: Enforce Serial/RTT Exclusivity

**Files:**
- Modify: `src/core/workspace/control-profile-schema.ts`
- Test: `tests/unit/core/workspace/control-profile-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
await expect(
  manager.init(root, {
    serial: { enabled: true, port: 'COM3', baudRate: 115200, mode: 'terminal' },
    rtt: { enabled: true },
  }),
).rejects.toThrow(/serial.*RTT|RTT.*serial/i);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/workspace/control-profile-manager.test.ts`
Expected: FAIL because both enabled sections are currently accepted.

- [ ] **Step 3: Write minimal implementation**

Add a shared Zod `superRefine` helper for profile body and persisted profile schemas that emits one custom issue when `serial.enabled === true && rtt.enabled === true`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/workspace/control-profile-manager.test.ts`
Expected: PASS.

### Task 2: Save Exactly One Observation Mode From UI

**Files:**
- Modify: `src/renderer/components/ControlProfilePanel.tsx`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`
- Test: `tests/unit/renderer/components/ControlProfilePanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add one test that expects serial mode to save `serial` without `rtt`, and one test that switches to RTT mode and expects `{ rtt: { enabled: true } }` without `serial`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/renderer/components/ControlProfilePanel.test.tsx`
Expected: FAIL because the current UI always saves `serial.enabled=true` and `rtt.enabled=false`.

- [ ] **Step 3: Write minimal implementation**

Add an observation-mode select with `serial` and `rtt`. Render serial fields only in serial mode. Build the save payload with only the selected observation section.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/renderer/components/ControlProfilePanel.test.tsx`
Expected: PASS.

### Task 3: Auto-Resolve RTT Log From Control Profile

**Files:**
- Modify: `src/shared/preload-api.ts`
- Modify: `src/main/ipc/rtt-log-session-ipc.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `tests/fixtures/mock-preload-api.ts`
- Test: `tests/unit/main/ipc/rtt-log-session-ipc.test.ts`

- [ ] **Step 1: Write the failing test**

Call `rttLog:open` with `{ root: <workspace>, label: 'RTT auto' }` after saving a profile with `jlink.enabled=true` and `rtt.enabled=true`. Expect `probeConnect`, `rttConnect`, and an opened RTT log summary.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/main/ipc/rtt-log-session-ipc.test.ts`
Expected: FAIL with `probeId is required`.

- [ ] **Step 3: Write minimal implementation**

Make `probeId` optional when `root` is provided. Inject `ControlProfileManager` into `registerRttLogSessionIpc`. For root mode, load profile, require `jlink.target` and `rtt.enabled=true`, connect the probe, run `rttConnect`, pick the first configured visible up channel or first visible up channel, and return `probeId/channelIndex` in the IPC success payload.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/main/ipc/rtt-log-session-ipc.test.ts`
Expected: PASS.

### Task 4: Verification

**Files:**
- No production edits.

- [ ] Run targeted tests:

```powershell
pnpm vitest run tests/unit/core/workspace/control-profile-manager.test.ts tests/unit/renderer/components/ControlProfilePanel.test.tsx tests/unit/main/ipc/rtt-log-session-ipc.test.ts
```

- [ ] Run `pnpm run build:main` if type changes cross main/preload boundaries.
- [ ] Run `detect_changes({scope:"all"})` and check changed symbols/flows are limited to control profile and RTT log IPC.
