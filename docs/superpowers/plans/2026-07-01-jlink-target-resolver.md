# J-Link Target Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LinkTerm treat the SEGGER XML device catalog as advisory evidence while using real J-Link attach/runtime behavior as the authority for Windows/WSL J-Link target validity.

**Architecture:** Add a small target-resolution module that normalizes target names, attaches catalog evidence, and emits warnings instead of blocking on catalog misses. Route `run_control_workflow` and root-based RTT auto-open through this module so catalog misses never prevent `probeConnect`, while actual SEGGER/J-Link failures remain classified at the operation that failed.

**Tech Stack:** TypeScript, Vitest, existing `IJLinkBackend`, `JLinkDeviceCatalog`, MCP workflow output structures, Electron IPC.

---

## File Structure

- Create `src/jlink/target-resolver.ts`
  - Owns target normalization plus catalog evidence.
  - Exports `resolveJLinkTarget`, `JLinkTargetResolution`, and `JLinkTargetResolutionWarning`.
  - Keeps catalog miss semantics advisory and reusable across MCP/IPC.
- Modify `src/jlink/index.ts`
  - Re-export the resolver module.
- Modify `src/mcp/surfaces/control-workflow/types.ts`
  - Add advisory blocking/warning compatible kind `jlink_target_not_in_catalog` only as evidence, not fatal preflight.
- Modify `src/mcp/surfaces/control-workflow/workflow-runner.ts`
  - Replace fatal `validateCatalogTargetIfAvailable` with resolver evidence in `preflight`.
  - Use resolver output in `connectProbeStep`.
  - Keep Commander/GDB executable not-found fatal; keep runtime J-Link operation failures classified by existing error translation.
- Modify `src/main/ipc/rtt-log-session-ipc.ts`
  - Replace fatal catalog validation with resolver before `probeConnect`.
  - Continue returning backend failures if `probeConnect`/`rttConnect` fails.
- Test `tests/unit/jlink/target-resolver.test.ts`
  - Unit coverage for exact catalog match, catalog miss warning, unavailable catalog, and STM32 order-code normalization.
- Modify `tests/unit/mcp/control-workflow-tools.test.ts`
  - Update catalog-miss behavior from "blocks before probe" to "warns and continues to probeConnect".
- Modify `tests/unit/main/ipc/rtt-log-session-ipc.test.ts`
  - Update catalog-miss behavior from "refuses auto-open" to "continues to auto-open".

## Impact Analysis Already Run

- `preflight`: LOW risk. Directly affects `run_control_workflow` MCP execution.
- `registerRttLogSessionIpc`: LOW risk. No indexed upstream callers, but it is a main-process IPC registration point.
- `ControlWorkflowRunnerDeps`: LOW risk. Existing dependency injection interface.
- `ControlWorkflowBlockingReason`: LOW risk. Existing workflow evidence shape.
- `validateCatalogTargetIfAvailable` and `resolveRttTarget` are not indexed by GitNexus, so edits must be covered by tests.

## Task 1: Add Advisory Target Resolver

**Files:**
- Create: `src/jlink/target-resolver.ts`
- Modify: `src/jlink/index.ts`
- Test: `tests/unit/jlink/target-resolver.test.ts`

- [ ] **Step 1: Write the failing resolver tests**

Add `tests/unit/jlink/target-resolver.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { JLinkDeviceCatalog } from '@/jlink/device-catalog.js';
import { resolveJLinkTarget } from '@/jlink/target-resolver.js';

function catalog(options: {
  available?: boolean;
  has?: boolean;
  devices?: Array<{ name: string; vendor?: string }>;
}): JLinkDeviceCatalog {
  return {
    search: vi.fn(async ({ query }) => ({
      available: options.available ?? true,
      sourceFiles: options.available === false ? [] : ['JLinkDevices.xml'],
      devices: (options.devices ?? []).map((device) => ({
        ...device,
        sourceFile: 'JLinkDevices.xml',
        flashBanks: [],
      })),
      ...(query === 'STM32H743II'
        ? { queryNormalization: { originalQuery: 'STM32H743IIT6', normalizedQuery: 'STM32H743II' } }
        : {}),
    })),
    get: vi.fn(async () => undefined),
    has: vi.fn(async () => options.has ?? false),
    refresh: vi.fn(async () => undefined),
  };
}

describe('resolveJLinkTarget', () => {
  it('returns normalized target and catalog match evidence when local catalog contains it', async () => {
    const result = await resolveJLinkTarget(' -AT32F435RGT7 ', catalog({ has: true }));

    expect(result.target).toBe('-AT32F435RGT7');
    expect(result.catalog?.available).toBe(true);
    expect(result.catalog?.matched).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('keeps catalog misses advisory so SEGGER built-in targets can still be tried at runtime', async () => {
    const result = await resolveJLinkTarget('STM32H743II', catalog({
      has: false,
      devices: [{ name: 'STM32H743ZI', vendor: 'ST' }],
    }));

    expect(result.target).toBe('STM32H743II');
    expect(result.catalog?.matched).toBe(false);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: 'jlink_target_not_in_catalog',
        target: 'STM32H743II',
        suggestions: [expect.objectContaining({ name: 'STM32H743ZI' })],
      }),
    ]);
  });

  it('does not warn when no local catalog database is available', async () => {
    const result = await resolveJLinkTarget('CUSTOM_TARGET', catalog({ available: false }));

    expect(result.target).toBe('CUSTOM_TARGET');
    expect(result.catalog?.available).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('records STM32 order-code normalization evidence', async () => {
    const result = await resolveJLinkTarget('STM32H743IIT6', catalog({ has: false }));

    expect(result.target).toBe('STM32H743II');
    expect(result.normalization).toMatchObject({
      originalTarget: 'STM32H743IIT6',
      normalizedTarget: 'STM32H743II',
      kind: 'stm32-order-code',
    });
  });
});
```

- [ ] **Step 2: Run the resolver test to verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/jlink/target-resolver.test.ts
```

Expected: FAIL because `src/jlink/target-resolver.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `src/jlink/target-resolver.ts`:

```ts
import type { JLinkDeviceCatalog, JLinkDeviceInfo } from './device-catalog.js';
import { classifyJLinkTargetName } from '../shared/jlink-target-name.js';

export interface JLinkTargetResolutionWarning {
  kind: 'jlink_target_not_in_catalog';
  target: string;
  originalTarget: string;
  message: string;
  suggestions: JLinkDeviceInfo[];
}

export interface JLinkTargetResolution {
  target: string;
  originalTarget: string;
  normalization?: {
    originalTarget: string;
    normalizedTarget: string;
    kind: 'stm32-order-code';
    message?: string;
  };
  catalog?: {
    available: boolean;
    matched: boolean;
    sourceFiles: string[];
    suggestions: JLinkDeviceInfo[];
  };
  warnings: JLinkTargetResolutionWarning[];
}

export async function resolveJLinkTarget(
  rawTarget: string,
  catalog?: JLinkDeviceCatalog,
): Promise<JLinkTargetResolution> {
  const classification = classifyJLinkTargetName(rawTarget);
  const result: JLinkTargetResolution = {
    target: classification.normalizedTarget,
    originalTarget: classification.originalTarget,
    warnings: [],
  };
  if (classification.kind === 'stm32-order-code') {
    result.normalization = {
      originalTarget: classification.originalTarget,
      normalizedTarget: classification.normalizedTarget,
      kind: classification.kind,
      ...(classification.message !== undefined ? { message: classification.message } : {}),
    };
  }
  if (catalog === undefined) return result;

  const search = await catalog.search({ query: classification.normalizedTarget, limit: 5 });
  if (!search.available) {
    result.catalog = { available: false, matched: false, sourceFiles: [], suggestions: [] };
    return result;
  }

  const matched = await catalog.has(classification.normalizedTarget);
  result.catalog = {
    available: true,
    matched,
    sourceFiles: search.sourceFiles,
    suggestions: search.devices,
  };
  if (!matched) {
    result.warnings.push({
      kind: 'jlink_target_not_in_catalog',
      target: classification.normalizedTarget,
      originalTarget: classification.originalTarget,
      message:
        `J-Link target ${classification.normalizedTarget} was not found in the local SEGGER XML/AddOn catalog; ` +
        'LinkTerm will still try the target because SEGGER may support built-in devices that are not listed in XML.',
      suggestions: search.devices,
    });
  }
  return result;
}
```

Modify `src/jlink/index.ts`:

```ts
export * from './target-resolver.js';
```

- [ ] **Step 4: Run the resolver test to verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/jlink/target-resolver.test.ts
```

Expected: PASS.

## Task 2: Make Control Workflow Catalog Miss Advisory

**Files:**
- Modify: `src/mcp/surfaces/control-workflow/workflow-runner.ts`
- Test: `tests/unit/mcp/control-workflow-tools.test.ts`

- [ ] **Step 1: Write/update the failing workflow test**

Replace the existing test named `blocks flash workflow before opening the probe when target is absent from installed SEGGER catalog` with:

```ts
it('continues flash workflow when target is absent from XML catalog and records advisory evidence', async () => {
  await teardown(h);
  const backend = new FakeJLinkBackend();
  h = await setup({
    jlinkBackend: backend,
    jlinkDeviceCatalog: {
      search: async () => ({
        available: true,
        sourceFiles: ['JLinkDevices.xml'],
        devices: [{ name: 'STM32H743ZI', vendor: 'ST', sourceFile: 'JLinkDevices.xml', flashBanks: [] }],
      }),
      get: async () => undefined,
      has: async () => false,
      refresh: async () => undefined,
    },
  });
  await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
  await h.controlProfileManager.init(h.root, {
    jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
    flash: { binary: 'rtthread.bin', baseAddress: '0x08000000', verify: true },
  }, { force: true });

  const out = await callTool(h.client, 'run_control_workflow', {
    root: h.root,
    mode: 'flash-observe',
    observe: { serial: false },
    confirm: true,
  });

  expect(out.success).toBe(true);
  const data = (out.evidence as {
    data: {
      failedStep?: string;
      steps: Array<{ id: string; evidence?: Record<string, unknown> }>;
      blockingReasons?: unknown[];
    };
  }).data;
  expect(data.failedStep).toBeUndefined();
  expect(data.blockingReasons).toBeUndefined();
  expect(data.steps.find((step) => step.id === 'preflight')?.evidence).toMatchObject({
    targetResolution: {
      target: 'STM32H743II',
      warnings: [expect.objectContaining({ kind: 'jlink_target_not_in_catalog' })],
    },
  });
  expect(data.steps.find((step) => step.id === 'connect_probe')?.evidence).toMatchObject({
    targetNormalization: {
      originalTarget: 'STM32H743IIT6',
      normalizedTarget: 'STM32H743II',
    },
  });
  expect(backend.callsOf('probeConnect')).toEqual([
    {
      method: 'probeConnect',
      args: [{ target: 'STM32H743II', interface: 'swd', speedKHz: 4000 }],
    },
  ]);
});
```

- [ ] **Step 2: Run the workflow test to verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/mcp/control-workflow-tools.test.ts -t "continues flash workflow when target is absent from XML catalog"
```

Expected: FAIL because current workflow records `failedStep: preflight` and does not call `probeConnect`.

- [ ] **Step 3: Implement advisory workflow behavior**

In `src/mcp/surfaces/control-workflow/workflow-runner.ts`:

- Import `resolveJLinkTarget` and `JLinkTargetResolution`.
- Add `targetResolution?: JLinkTargetResolution` to `WorkflowContext`.
- In `preflight`, replace `validateCatalogTargetIfAvailable(ctx, jlinkDeviceCatalog)` with:

```ts
ctx.targetResolution = await resolveJLinkTarget(profile.jlink.target, jlinkDeviceCatalog);
```

- Use `ctx.targetResolution.target` when checking Commander/GDB availability.
- Add `targetResolution: ctx.targetResolution` to the `preflight` passed evidence.
- Remove or stop calling the fatal `validateCatalogTargetIfAvailable` helper.
- In `connectProbeStep`, use `ctx.targetResolution ?? await resolveJLinkTarget(jlink.target)` instead of directly calling `classifyJLinkTargetName`.
- Keep existing `targetNormalization` evidence by reading `resolution.normalization`.

- [ ] **Step 4: Run the workflow target test to verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/mcp/control-workflow-tools.test.ts -t "continues flash workflow when target is absent from XML catalog"
```

Expected: PASS.

## Task 3: Make Root-Based RTT Auto-Open Catalog Miss Advisory

**Files:**
- Modify: `src/main/ipc/rtt-log-session-ipc.ts`
- Test: `tests/unit/main/ipc/rtt-log-session-ipc.test.ts`

- [ ] **Step 1: Write/update the failing RTT IPC test**

Replace the existing test named `refuses RTT auto-open when profile target is not in the installed SEGGER catalog` with:

```ts
it('continues RTT auto-open when profile target is absent from XML catalog', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-rtt-ipc-catalog-'));
  try {
    const sessionManager = new SessionManager();
    const backend = new FakeJLinkBackend();
    const controlProfileManager = new ControlProfileManager();
    const catalog = {
      search: vi.fn(async () => ({ available: true, sourceFiles: ['JLinkDevices.xml'], devices: [] })),
      get: vi.fn(async () => undefined),
      has: vi.fn(async () => false),
      refresh: vi.fn(async () => undefined),
    };
    registerRttLogSessionIpc(sessionManager, backend, controlProfileManager, catalog);
    await controlProfileManager.init(root, {
      jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
      rtt: { enabled: true },
    }, { force: true });

    const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;
    const result = await handler({}, { root }) as { success: boolean; data?: { channelIndex: number } };

    expect(result.success).toBe(true);
    expect(result.data?.channelIndex).toBe(0);
    expect(backend.callsOf('probeConnect')).toEqual([
      {
        method: 'probeConnect',
        args: [{ target: 'STM32H743II', interface: 'swd', speedKHz: 4000 }],
      },
    ]);
    expect(backend.callsOf('rttConnect')).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the RTT IPC test to verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/main/ipc/rtt-log-session-ipc.test.ts -t "continues RTT auto-open when profile target is absent from XML catalog"
```

Expected: FAIL because current code throws `J-Link target ... is not in the installed SEGGER device catalog`.

- [ ] **Step 3: Implement advisory RTT behavior**

In `src/main/ipc/rtt-log-session-ipc.ts`:

- Import `resolveJLinkTarget`.
- Remove the fatal `validateCatalogTargetIfAvailable` helper.
- In `resolveRttTarget`, after `const opts = buildProbeConnectOptions(profile);`, call:

```ts
const resolution = await resolveJLinkTarget(opts.target, jlinkDeviceCatalog);
const probe = await jlinkBackend.probeConnect({ ...opts, target: resolution.target });
```

- Do not fail on `resolution.warnings`; backend errors still propagate through existing `errorCodeOf`.

- [ ] **Step 4: Run the RTT IPC test to verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/main/ipc/rtt-log-session-ipc.test.ts -t "continues RTT auto-open when profile target is absent from XML catalog"
```

Expected: PASS.

## Task 4: Regression Sweep and Final Safety Check

**Files:**
- No new production files unless earlier tasks reveal compile errors.

- [ ] **Step 1: Run targeted suites**

Run:

```bash
pnpm exec vitest run tests/unit/jlink/target-resolver.test.ts tests/unit/jlink/device-catalog.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/rtt-log-session-ipc.test.ts tests/unit/jlink/segger-command-runner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run project verification**

Run:

```bash
pnpm test
pnpm run build:main
pnpm run lint
```

Expected: all PASS.

- [ ] **Step 3: Run GitNexus detect_changes**

Run:

```bash
node .gitnexus/run.cjs detect_changes --repo link-mcp --scope all
```

Expected: reports affected J-Link/control workflow/RTT flows. If risk is HIGH or CRITICAL, final report must call it out explicitly.

- [ ] **Step 4: Final report**

Summarize:

- Catalog miss is now warning/advisory, not a preflight block.
- Runtime SEGGER operations are the authority for true support/failure.
- Key files changed.
- Exact validation commands and results.
- Any remaining risks, especially if `detect_changes` reports HIGH or CRITICAL.
