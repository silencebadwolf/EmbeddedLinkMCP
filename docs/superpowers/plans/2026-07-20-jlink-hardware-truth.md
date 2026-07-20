# J-Link Hardware Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every J-Link connection, progress, and completion claim correspond to fresh hardware or Commander evidence.

**Architecture:** Keep `IJLinkBackend` as the hardware boundary, but require its production adapter to validate target access through the Commander client before exposing a connected handle. Preserve stage-only progress separately from measured Commander percentages, and let the renderer display only evidence-backed numeric values.

**Tech Stack:** Electron, TypeScript, Vitest, SEGGER J-Link Commander process adapter, React, OpenSpec, GitNexus.

---

### Task 1: Fail closed when target access is not proven

**Files:**
- Modify: `src/jlink/segger-command-runner.ts`
- Modify: `src/jlink/jlink-adapter.ts`
- Modify: `tests/unit/jlink/segger-command-runner.test.ts`
- Modify: `tests/unit/jlink/jlink-adapter.test.ts`

- [ ] **Step 1: Write the failing Commander evidence tests**

Add tests that call a new `connectTarget()` operation with captured process results:

```ts
await expect(client.connectTarget(probe)).rejects.toThrow(
  /without positive target connection evidence/i,
);
```

and accept output containing `Found SW-DP with ID ...` or `Cortex-M4 identified`.

- [ ] **Step 2: Run the Commander tests and verify RED**

Run: `pnpm exec vitest run tests/unit/jlink/segger-command-runner.test.ts -t "target connection evidence"`

Expected: FAIL because `connectTarget` does not exist.

- [ ] **Step 3: Add the minimal Commander target-access operation**

Add an optional client seam and a production implementation:

```ts
connectTarget?(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void>;
```

The default implementation runs the existing controlled connection preamble, calls
`assertCommanderSuccess`, and then calls a focused positive-evidence assertion. It issues no flash,
erase, reset, halt, GDB, or RTT command.

- [ ] **Step 4: Run the Commander tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/jlink/segger-command-runner.test.ts -t "target connection evidence"`

Expected: PASS.

- [ ] **Step 5: Write adapter RED tests**

Cover three public behaviors:

```ts
await expect(adapter.probeConnect(opts)).rejects.toThrow('target unavailable');
await expect(adapter.probeStatus(probeId)).rejects.toThrow('target unavailable');
expect(await adapter.probeDetect()).toEqual([{ probeId: 'physical-0', connected: false }]);
```

The failed connect assertion must also prove no connected handle remains discoverable.

- [ ] **Step 6: Run adapter tests and verify RED**

Run: `pnpm exec vitest run tests/unit/jlink/jlink-adapter.test.ts`

Expected: FAIL because the adapter currently mints/reuses handles without calling Commander and
merges retained handles into discovery.

- [ ] **Step 7: Implement adapter validation and stale-handle retirement**

Before create/reuse, require `commander.connectTarget`; missing support throws
`JLinkNotImplementedError('probeConnect')`. Revalidate in `probeStatus`; delete an idle stale handle
when validation fails. Make `probeDetect` return Commander physical discovery only.

- [ ] **Step 8: Run adapter and dependent J-Link tests**

Run: `pnpm exec vitest run tests/unit/jlink/jlink-adapter.test.ts tests/unit/jlink/jlink-adapter-flash.test.ts tests/unit/core/control-profile-chip.test.ts`

Expected: PASS with no hardware process.

### Task 2: Propagate connection failure through workflow and UI

**Files:**
- Modify: `tests/unit/main/ipc/control-profile-ipc.test.ts`
- Modify: `tests/unit/mcp/control-workflow-tools.test.ts`
- Modify only if tests expose a gap: `src/main/ipc/control-profile-ipc.ts`
- Modify only if tests expose a gap: `src/mcp/surfaces/control-workflow/workflow-runner.ts`

- [ ] **Step 1: Add failure propagation tests**

Use an injected backend whose `probeConnect` rejects with `JLinkOperationError`. Assert the IPC
result is unsuccessful, the UI-facing payload contains no probe, the workflow connect step fails,
and `summary.probeConnected` remains false.

- [ ] **Step 2: Run focused tests and verify RED or existing safe propagation**

Run: `pnpm exec vitest run tests/unit/main/ipc/control-profile-ipc.test.ts tests/unit/mcp/control-workflow-tools.test.ts -t "target access"`

Expected: the new assertions fail if either surface converts the error into success. If they pass
without product edits, record that Task 1 is the sole production fix for this slice.

- [ ] **Step 3: Apply only the minimal propagation fix if required**

Keep `connectControlProfileChip()` and `connectProbeStep()` dependent on the backend promise; do not
catch a target-access failure as a successful handle.

- [ ] **Step 4: Re-run focused tests**

Expected: PASS.

### Task 3: Remove invented download percentages and byte counts

**Files:**
- Modify: `src/jlink/segger-command-runner.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `tests/unit/jlink/segger-command-runner.test.ts`
- Modify: `tests/unit/renderer/App.test.tsx`

- [ ] **Step 1: Write runner RED tests**

Assert that preparing/erasing updates without Commander numeric output have no `percent`, and that a
streamed `40%` update has `percent: 40` but no synthesized `bytesWritten`.

- [ ] **Step 2: Verify runner RED**

Run: `pnpm exec vitest run tests/unit/jlink/segger-command-runner.test.ts -t "flash progress"`

Expected: FAIL on the current synthetic 0%, 5%, or calculated byte count.

- [ ] **Step 3: Implement honest runner progress**

Remove preassigned numeric percentages from stage events and remove:

```ts
Math.round((bytesTotal * percent) / 100)
```

Keep a terminal 100% event only after download and required verification succeed.

- [ ] **Step 4: Write renderer RED tests**

Assert the status fill is `0%` for idle, failed-without-measurement, and running-with-stage-only
evidence; it is the exact backend percentage when provided and 100% on successful terminal state.

- [ ] **Step 5: Verify renderer RED**

Run: `pnpm exec vitest run tests/unit/renderer/App.test.tsx -t "download progress"`

Expected: FAIL because idle is currently 18%, failure 100%, and missing progress is step-derived.

- [ ] **Step 6: Implement renderer evidence-only width**

Make the selector return `number | undefined`. `StatusBar` renders an empty fill when undefined and
adds numeric accessibility metadata only when a value exists.

- [ ] **Step 7: Re-run runner and renderer tests**

Expected: PASS.

### Task 4: Distinguish verified and unverified completion

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`
- Modify: `tests/unit/renderer/App.test.tsx`

- [ ] **Step 1: Write completion wording RED tests**

Create succeeded job fixtures with `summary.verified=true` and `false`. Expect “Download verified”
versus “Download command completed · not verified”, with equivalent Chinese translations.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/renderer/App.test.tsx -t "verified completion"`

Expected: FAIL because both paths currently use one generic “Download complete” label.

- [ ] **Step 3: Implement bilingual truth-preserving labels**

Select the terminal label from `download.result.summary.verified`; do not infer verification from job
state alone.

- [ ] **Step 4: Re-run renderer tests**

Expected: PASS in English and Chinese.

### Task 5: Cross-cutting verification

**Files:**
- Update: `openspec/changes/enforce-jlink-hardware-truth/tasks.md`

- [ ] **Step 1: Run focused suites**

Run all J-Link adapter/runner, control workflow, control-profile IPC, and App tests.

- [ ] **Step 2: Run full gates**

Run: `pnpm run ci:check`

Expected: lint, TypeScript/Vite build, all tests, and license validation pass.

- [ ] **Step 3: Validate OpenSpec**

Run: `pnpm exec openspec validate enforce-jlink-hardware-truth --strict --no-interactive`

Expected: PASS.

- [ ] **Step 4: Run GitNexus post-change checks**

Run `detect_changes`, directed PDG impact, and taint explanation for the modified J-Link and Renderer
files. Treat zero taint findings as limited evidence, not proof of hardware truth.

- [ ] **Step 5: Review final diff and leave worktree uncommitted**

Run: `git diff --check` and `git status --short`.

Do not commit or push unless the user explicitly asks.
