# J-Link Device Catalog Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragile hand-entered J-Link target guessing with a SEGGER device catalog search/selection path shared by UI, IPC, MCP, and preflight validation.

**Architecture:** Add a deep `JLinkDeviceCatalog` module that hides SEGGER XML discovery, parsing, caching, and search ranking behind `search/get/refresh` methods. UI and MCP use the catalog as the source of truth for selectable J-Link device names, while the existing STM32 order-code normalizer stays only as a compatibility fallback. Flash/RTT/GDB automation validates targets against the catalog when a local SEGGER database is available, preventing automation from opening the J-Link Device Selection dialog.

**Tech Stack:** Electron main IPC, TypeScript, Vitest, React, MCP SDK, SEGGER `JLinkDevices.xml`, GitNexus impact/detect_changes.

---

## Current Problem

The current implementation normalizes only a narrow STM32 full order-code pattern such as `STM32H743IIT6 -> STM32H743II`. That avoids one failure mode, but it does not solve the general problem:

- SEGGER device names are local installation facts, not universal guesses.
- Some vendor AddOn devices are registered with exact names such as `-AT32F403ZCT6`.
- Changing chip or computer can invalidate a manually typed target.
- If an unknown target reaches Commander/GDB Server, automation can block on the J-Link Device Selection dialog.

## Target Behavior

1. LinkTerm discovers installed SEGGER device database files from the local J-Link installation.
2. Users select a real catalog entry in the control profile UI.
3. Agents can query the same catalog through MCP tools before writing a profile.
4. Existing profiles with unknown or stale targets are diagnosed with suggested catalog matches.
5. High-impact J-Link automation refuses unknown targets when a local catalog is available.

## File Structure

- Create `src/jlink/device-catalog.ts`
  - Deep module for device database path discovery, XML parsing, search ranking, exact lookup, cache invalidation, and target validation.
- Modify `src/jlink/index.ts`
  - Barrel export catalog types and factory.
- Create `tests/unit/jlink/device-catalog.test.ts`
  - Unit coverage for XML parsing, AddOn names, flash bank metadata, search ranking, and cache refresh.
- Create `src/main/ipc/jlink-device-catalog-ipc.ts`
  - Main-process IPC handlers for catalog search/get/refresh.
- Create `tests/unit/main/ipc/jlink-device-catalog-ipc.test.ts`
  - IPC handler contract tests.
- Modify `src/shared/preload-api.ts`
  - Add `jlinkDevices` namespace and serializable DTO types.
- Modify `src/shared/ipc-protocol.ts`
  - Add `jlinkDevices:*` channels.
- Modify `src/main/preload.ts`
  - Expose `window.linkterm.jlinkDevices`.
- Modify `tests/fixtures/mock-preload-api.ts`
  - Add mock `jlinkDevices` spies.
- Modify `src/main/ipc/index.ts`
  - Instantiate one catalog and register IPC; pass catalog to MCP/control surfaces.
- Modify `src/renderer/components/ControlProfilePanel.tsx`
  - Replace free-only target entry with searchable catalog-backed selector while preserving manual fallback.
- Modify `src/renderer/i18n/en.ts` and `src/renderer/i18n/zh.ts`
  - Add labels/messages for search status, catalog selection, and manual fallback.
- Modify `tests/unit/renderer/components/ControlProfilePanel.test.tsx`
  - UI coverage for selecting catalog entry and manual fallback.
- Modify `src/mcp/server.ts`
  - Accept optional `jlinkDeviceCatalog` dependency.
- Create `src/mcp/surfaces/jlink-device-catalog/tools.ts`
  - MCP read-only tools for catalog search/get.
- Create `src/mcp/surfaces/jlink-device-catalog/schemas.ts`
  - Zod schemas for catalog MCP tools.
- Create `tests/unit/mcp/jlink-device-catalog-tools.test.ts`
  - MCP tool coverage.
- Modify `src/mcp/surfaces/control-profile/tools.ts`
  - `inspect_control_profile` reports catalog validation/suggestions.
- Modify `src/mcp/surfaces/control-workflow/workflow-runner.ts`
  - Preflight refuses high-impact runs when catalog exists and target is not in it.
- Modify `src/main/ipc/rtt-log-session-ipc.ts`
  - RTT auto-open validates catalog target before connecting when catalog is available.
- Modify relevant tests:
  - `tests/unit/mcp/control-profile-tools.test.ts`
  - `tests/unit/mcp/control-workflow-tools.test.ts`
  - `tests/unit/main/ipc/rtt-log-session-ipc.test.ts`

## Governance Requirements

- Before editing any existing function, method, class, or interface, run GitNexus:

```text
impact({ repo: "link-mcp", target: "<symbol>", direction: "upstream", summaryOnly: true })
```

- If impact risk is HIGH or CRITICAL, stop and report the risk before editing.
- Follow TDD for each behavior: write failing test, run and confirm fail, implement, rerun and confirm pass.
- Do not revert user changes. Current unrelated dirty files must remain untouched unless directly required.
- Before final report or commit, run:

```text
detect_changes({ repo: "link-mcp", scope: "all" })
pnpm test
pnpm run build:main
pnpm run lint
```

---

### Task 1: J-Link Device Catalog Deep Module

**Files:**
- Create: `src/jlink/device-catalog.ts`
- Modify: `src/jlink/index.ts`
- Test: `tests/unit/jlink/device-catalog.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Create `tests/unit/jlink/device-catalog.test.ts`:

```ts
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJLinkDeviceCatalog } from '@/jlink/device-catalog.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdir(path.join(os.tmpdir(), `linkterm-jlink-catalog-${Date.now()}-${Math.random()}`), {
    recursive: true,
  }).then(() => path.join(os.tmpdir(), `linkterm-jlink-catalog-${Date.now()}-${Math.random()}`));
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}

async function writeXml(root: string, relativePath: string, text: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf-8');
  return filePath;
}

describe('JLinkDeviceCatalog', () => {
  let root: string;

  beforeEach(async () => {
    root = await tempRoot();
  });

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (dir) => {
      await import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true }));
    }));
  });

  it('parses SEGGER XML device names, vendor/core, script, and flash banks', async () => {
    await writeXml(root, 'JLinkDevices.xml', `
      <DataBase>
        <Device>
          <ChipInfo Name="-AT32F435RGT7" Vendor="ArteryTek" Core="JLINK_CORE_CORTEX_M4" JLinkScriptFile="Devices/ArteryTek/AT32F4xx.JLinkScript"/>
          <FlashBankInfo Name="Flash Bank1" BaseAddr="0x08000000" MaxSize="0x00100000" Loader="Devices/ArteryTek/AT32FLM/AT32F435_1024.FLM"/>
        </Device>
        <Device>
          <ChipInfo Name="STM32H743II" Vendor="ST" Core="JLINK_CORE_CORTEX_M7"/>
        </Device>
      </DataBase>
    `);
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });

    const result = await catalog.search({ query: 'AT32F435', limit: 5 });

    expect(result.available).toBe(true);
    expect(result.devices[0]).toMatchObject({
      name: '-AT32F435RGT7',
      vendor: 'ArteryTek',
      core: 'JLINK_CORE_CORTEX_M4',
      jlinkScriptFile: 'Devices/ArteryTek/AT32F4xx.JLinkScript',
      flashBanks: [
        {
          name: 'Flash Bank1',
          baseAddress: '0x08000000',
          maxSize: '0x00100000',
          loader: 'Devices/ArteryTek/AT32FLM/AT32F435_1024.FLM',
        },
      ],
    });
    expect(result.sourceFiles).toEqual([path.join(root, 'JLinkDevices.xml')]);
  });

  it('searches AddOn Devices XML files and ranks exact/prefix matches first', async () => {
    await writeXml(root, 'JLinkDevices.xml', '<DataBase><Device><ChipInfo Name="STM32F407VG" Vendor="ST"/></Device></DataBase>');
    await writeXml(root, 'Devices/Vendor/Pack.xml', '<DataBase><Device><ChipInfo Name="-AT32F435RGT7" Vendor="ArteryTek"/></Device></DataBase>');
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });

    const result = await catalog.search({ query: 'AT32F435RGT7', limit: 10 });

    expect(result.devices.map((d) => d.name)[0]).toBe('-AT32F435RGT7');
  });

  it('normalizes STM32 order-code query only for suggestions and preserves registered catalog names', async () => {
    await writeXml(root, 'JLinkDevices.xml', '<DataBase><Device><ChipInfo Name="STM32H743II" Vendor="ST"/></Device></DataBase>');
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });

    const result = await catalog.search({ query: 'STM32H743IIT6', limit: 5 });

    expect(result.devices[0]?.name).toBe('STM32H743II');
    expect(result.queryNormalization).toEqual({ originalQuery: 'STM32H743IIT6', normalizedQuery: 'STM32H743II' });
  });

  it('returns unavailable instead of throwing when no SEGGER database exists', async () => {
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });

    const result = await catalog.search({ query: 'STM32', limit: 5 });

    expect(result.available).toBe(false);
    expect(result.devices).toEqual([]);
    expect(result.reason).toBe('database-not-found');
  });

  it('refreshes cache when source mtime changes', async () => {
    const xml = await writeXml(root, 'JLinkDevices.xml', '<DataBase><Device><ChipInfo Name="STM32F407VG" Vendor="ST"/></Device></DataBase>');
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });
    expect((await catalog.get('STM32F407VG'))?.name).toBe('STM32F407VG');
    await writeFile(xml, '<DataBase><Device><ChipInfo Name="STM32H743II" Vendor="ST"/></Device></DataBase>', 'utf-8');
    const now = new Date(Date.now() + 2000);
    await utimes(xml, now, now);

    await catalog.refresh();

    expect(await catalog.get('STM32F407VG')).toBeUndefined();
    expect((await catalog.get('STM32H743II'))?.name).toBe('STM32H743II');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm exec vitest run tests/unit/jlink/device-catalog.test.ts
```

Expected: FAIL because `src/jlink/device-catalog.ts` does not exist.

- [ ] **Step 3: Implement catalog module**

Before editing `src/jlink/index.ts`, run GitNexus impact on `index.ts` barrel exports if needed. Create `src/jlink/device-catalog.ts` with these public types and factory:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { normalizeJLinkTargetName } from '../shared/jlink-target-name.js';
import { resolveDefaultCommanderPath } from './segger-command-runner.js';

export interface JLinkDeviceFlashBank {
  name?: string;
  baseAddress?: string;
  maxSize?: string;
  loader?: string;
}

export interface JLinkDeviceInfo {
  name: string;
  vendor?: string;
  core?: string;
  jlinkScriptFile?: string;
  sourceFile: string;
  flashBanks: JLinkDeviceFlashBank[];
}

export interface JLinkDeviceSearchRequest {
  query?: string;
  vendor?: string;
  limit?: number;
}

export interface JLinkDeviceSearchResult {
  available: boolean;
  reason?: 'database-not-found';
  devices: JLinkDeviceInfo[];
  sourceFiles: string[];
  queryNormalization?: { originalQuery: string; normalizedQuery: string };
}

export interface JLinkDeviceCatalog {
  search(request: JLinkDeviceSearchRequest): Promise<JLinkDeviceSearchResult>;
  get(name: string): Promise<JLinkDeviceInfo | undefined>;
  has(name: string): Promise<boolean>;
  refresh(): Promise<void>;
}

export interface JLinkDeviceCatalogOptions {
  installRoots?: readonly string[];
  commanderPath?: string;
}

export function createJLinkDeviceCatalog(options: JLinkDeviceCatalogOptions = {}): JLinkDeviceCatalog {
  return new DefaultJLinkDeviceCatalog(options);
}
```

Implementation details:

- Resolve install roots from `options.installRoots`, `options.commanderPath`, `resolveDefaultCommanderPath()`, and common Windows/Linux/macOS SEGGER roots.
- Discover files:
  - `<root>/JLinkDevices.xml`
  - `<root>/Devices/**/*.xml`
  - cap recursive scan at 2000 XML files.
- Parse XML with small attribute regexes; use the local SEGGER XML shape:
  - `<Device> ... <ChipInfo ... Name="..."> ... <FlashBankInfo ...> ... </Device>`
  - Extract attributes with `(\w+)\s*=\s*"([^"]*)"` and decode XML entities `&quot; &amp; &lt; &gt; &apos;`.
- Keep exact registered `Name` unchanged, including leading `-`.
- Search ranking:
  - exact case-insensitive match score 0
  - prefix match score 1
  - substring match score 2
  - vendor/core/loader substring score 3
  - sort by score then `name.length` then `name.localeCompare`.
- Query fallback:
  - If `normalizeJLinkTargetName(query) !== query.trim()`, search normalized query as an additional token and return `queryNormalization`.
- Cache:
  - Store source file path + `mtimeMs` + `size`.
  - Rebuild when source signature changes or `refresh()` is called.
  - `search()` and `get()` should not throw for missing databases; return unavailable/undefined.

Modify `src/jlink/index.ts`:

```ts
export * from './device-catalog.js';
```

- [ ] **Step 4: Run catalog tests**

Run:

```bash
pnpm exec vitest run tests/unit/jlink/device-catalog.test.ts
```

Expected: PASS.

---

### Task 2: IPC And Preload Device Catalog Surface

**Files:**
- Create: `src/main/ipc/jlink-device-catalog-ipc.ts`
- Modify: `src/shared/ipc-protocol.ts`
- Modify: `src/shared/preload-api.ts`
- Modify: `src/main/preload.ts`
- Modify: `tests/fixtures/mock-preload-api.ts`
- Modify: `src/main/ipc/index.ts`
- Test: `tests/unit/main/ipc/jlink-device-catalog-ipc.test.ts`
- Test: `tests/unit/main/electron-runtime.test.ts`

- [ ] **Step 1: Run GitNexus impact for existing symbols**

Run impact before editing:

```text
impact({ repo: "link-mcp", target: "IPC_CHANNELS", direction: "upstream", summaryOnly: true })
impact({ repo: "link-mcp", target: "PreloadAPI", direction: "upstream", summaryOnly: true })
impact({ repo: "link-mcp", target: "api", file_path: "src/main/preload.ts", direction: "upstream", summaryOnly: true })
impact({ repo: "link-mcp", target: "registerIpcHandlers", direction: "upstream", summaryOnly: true })
```

If any result is HIGH/CRITICAL, report it before editing.

- [ ] **Step 2: Write failing IPC tests**

Create `tests/unit/main/ipc/jlink-device-catalog-ipc.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { handlers, ipcMainMock } = vi.hoisted(() => {
  const map = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    handlers: map,
    ipcMainMock: {
      handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => map.set(channel, fn)),
      removeHandler: vi.fn((channel: string) => map.delete(channel)),
    },
  };
});

const electronMock = { app: {}, ipcMain: ipcMainMock };
globalThis.__linktermElectronMock = electronMock;
vi.mock('electron', () => ({ default: electronMock, ...electronMock }));

import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import type { JLinkDeviceCatalog } from '../../../../src/jlink/device-catalog.js';
import type { registerJLinkDeviceCatalogIpc as RegisterJLinkDeviceCatalogIpc } from '../../../../src/main/ipc/jlink-device-catalog-ipc.js';

let registerJLinkDeviceCatalogIpc: typeof RegisterJLinkDeviceCatalogIpc;

function makeCatalog(): JLinkDeviceCatalog {
  return {
    search: vi.fn(async () => ({
      available: true,
      devices: [{ name: '-AT32F435RGT7', vendor: 'ArteryTek', sourceFile: 'JLinkDevices.xml', flashBanks: [] }],
      sourceFiles: ['JLinkDevices.xml'],
    })),
    get: vi.fn(async (name: string) =>
      name === '-AT32F435RGT7'
        ? { name, vendor: 'ArteryTek', sourceFile: 'JLinkDevices.xml', flashBanks: [] }
        : undefined,
    ),
    has: vi.fn(async (name: string) => name === '-AT32F435RGT7'),
    refresh: vi.fn(async () => undefined),
  };
}

describe('registerJLinkDeviceCatalogIpc', () => {
  beforeEach(async () => {
    ({ registerJLinkDeviceCatalogIpc } = await import('../../../../src/main/ipc/jlink-device-catalog-ipc.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('searches catalog devices', async () => {
    const catalog = makeCatalog();
    registerJLinkDeviceCatalogIpc(catalog);

    const handler = handlers.get(IPC_CHANNELS.JLINK_DEVICES_SEARCH)!;
    const result = await handler({}, { query: 'AT32F435', limit: 5 }) as { success: boolean; data?: { devices: unknown[] } };

    expect(result.success).toBe(true);
    expect(result.data?.devices).toHaveLength(1);
    expect(catalog.search).toHaveBeenCalledWith({ query: 'AT32F435', limit: 5 });
  });

  it('gets a catalog device by exact registered name', async () => {
    const catalog = makeCatalog();
    registerJLinkDeviceCatalogIpc(catalog);

    const handler = handlers.get(IPC_CHANNELS.JLINK_DEVICES_GET)!;
    const result = await handler({}, { name: '-AT32F435RGT7' }) as { success: boolean; data?: { device?: { name: string } } };

    expect(result.success).toBe(true);
    expect(result.data?.device?.name).toBe('-AT32F435RGT7');
  });

  it('refreshes the catalog cache', async () => {
    const catalog = makeCatalog();
    registerJLinkDeviceCatalogIpc(catalog);

    const handler = handlers.get(IPC_CHANNELS.JLINK_DEVICES_REFRESH)!;
    const result = await handler({}, undefined) as { success: boolean };

    expect(result.success).toBe(true);
    expect(catalog.refresh).toHaveBeenCalled();
  });

  it('rejects invalid search payloads', async () => {
    const catalog = makeCatalog();
    registerJLinkDeviceCatalogIpc(catalog);

    const handler = handlers.get(IPC_CHANNELS.JLINK_DEVICES_SEARCH)!;
    const result = await handler({}, { limit: -1 }) as { success: boolean; error?: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAYLOAD');
  });

  it('dispose unregisters handlers', () => {
    const dispose = registerJLinkDeviceCatalogIpc(makeCatalog());
    dispose();

    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.JLINK_DEVICES_SEARCH);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.JLINK_DEVICES_GET);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.JLINK_DEVICES_REFRESH);
  });
});
```

- [ ] **Step 3: Run failing IPC tests**

Run:

```bash
pnpm exec vitest run tests/unit/main/ipc/jlink-device-catalog-ipc.test.ts
```

Expected: FAIL because the IPC module/channels do not exist.

- [ ] **Step 4: Implement IPC/preload surface**

Implement `src/main/ipc/jlink-device-catalog-ipc.ts`:

```ts
import type { JLinkDeviceCatalog, JLinkDeviceSearchRequest } from '../../jlink/device-catalog.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type { JLinkDeviceInfoPayload, JLinkDeviceSearchResultPayload, PreloadResult } from '../../shared/preload-api.js';
import { electron } from '../electron-runtime.js';

const { ipcMain } = electron;

export function registerJLinkDeviceCatalogIpc(catalog: JLinkDeviceCatalog): () => void {
  ipcMain.handle(IPC_CHANNELS.JLINK_DEVICES_SEARCH, async (_event, raw: unknown) => {
    try {
      const request = parseSearchPayload(raw);
      const result = await catalog.search(request);
      return { success: true, data: result satisfies JLinkDeviceSearchResultPayload };
    } catch (err) {
      return toIpcError(err);
    }
  });
  ipcMain.handle(IPC_CHANNELS.JLINK_DEVICES_GET, async (_event, raw: unknown) => {
    try {
      const name = parseNamePayload(raw);
      const device = await catalog.get(name);
      return { success: true, data: { device } satisfies { device?: JLinkDeviceInfoPayload } };
    } catch (err) {
      return toIpcError(err);
    }
  });
  ipcMain.handle(IPC_CHANNELS.JLINK_DEVICES_REFRESH, async () => {
    try {
      await catalog.refresh();
      return { success: true, data: { refreshed: true as const } };
    } catch (err) {
      return toIpcError(err);
    }
  });
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.JLINK_DEVICES_SEARCH);
    ipcMain.removeHandler(IPC_CHANNELS.JLINK_DEVICES_GET);
    ipcMain.removeHandler(IPC_CHANNELS.JLINK_DEVICES_REFRESH);
  };
}

function parseSearchPayload(raw: unknown): JLinkDeviceSearchRequest {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const r = raw as { query?: unknown; vendor?: unknown; limit?: unknown };
  const request: JLinkDeviceSearchRequest = {};
  if (r.query !== undefined) {
    if (typeof r.query !== 'string') throw new Error('query must be a string');
    request.query = r.query;
  }
  if (r.vendor !== undefined) {
    if (typeof r.vendor !== 'string') throw new Error('vendor must be a string');
    request.vendor = r.vendor;
  }
  if (r.limit !== undefined) {
    if (!Number.isInteger(r.limit) || r.limit < 1 || r.limit > 100) throw new Error('limit must be 1..100');
    request.limit = r.limit;
  }
  return request;
}

function parseNamePayload(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const name = (raw as { name?: unknown }).name;
  if (typeof name !== 'string' || name.trim() === '') throw new Error('name is required');
  return name;
}

function toIpcError<T>(err: unknown): PreloadResult<T> {
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INVALID_PAYLOAD', message } };
}
```

Modify `IPC_CHANNELS`:

```ts
JLINK_DEVICES_SEARCH: 'jlinkDevices:search',
JLINK_DEVICES_GET: 'jlinkDevices:get',
JLINK_DEVICES_REFRESH: 'jlinkDevices:refresh',
```

Add `JLinkDevicesNamespace` and payload types in `src/shared/preload-api.ts`, then add `jlinkDevices: JLinkDevicesNamespace` to `PreloadAPI`.

Expose methods in `src/main/preload.ts`:

```ts
jlinkDevices: {
  search: (req) => invoke<JLinkDeviceSearchResultPayload>(IPC_CHANNELS.JLINK_DEVICES_SEARCH, req),
  get: (req) => invoke<{ device?: JLinkDeviceInfoPayload }>(IPC_CHANNELS.JLINK_DEVICES_GET, req),
  refresh: () => invoke<{ refreshed: true }>(IPC_CHANNELS.JLINK_DEVICES_REFRESH),
},
```

Update `tests/fixtures/mock-preload-api.ts` with `jlinkDevices.search/get/refresh` spies.

Modify `src/main/ipc/index.ts`:

```ts
import { createJLinkDeviceCatalog } from '../../jlink/index.js';
import { registerJLinkDeviceCatalogIpc } from './jlink-device-catalog-ipc.js';
```

Instantiate once:

```ts
const jlinkDeviceCatalog = createJLinkDeviceCatalog();
```

Register and dispose:

```ts
const unregisterJLinkDeviceCatalog = registerJLinkDeviceCatalogIpc(jlinkDeviceCatalog);
```

Add `jlinkDeviceCatalog` to `MainProcessContext`.

- [ ] **Step 5: Run IPC/preload tests**

Run:

```bash
pnpm exec vitest run tests/unit/main/ipc/jlink-device-catalog-ipc.test.ts tests/unit/main/electron-runtime.test.ts
```

Expected: PASS.

---

### Task 3: Catalog-Backed Control Profile UI

**Files:**
- Modify: `src/renderer/components/ControlProfilePanel.tsx`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`
- Modify: `tests/unit/renderer/components/ControlProfilePanel.test.tsx`

- [ ] **Step 1: Run GitNexus impact**

Run:

```text
impact({ repo: "link-mcp", target: "ControlProfilePanel", direction: "upstream", summaryOnly: true })
```

If HIGH/CRITICAL, report before editing.

- [ ] **Step 2: Write failing UI tests**

Append tests to `tests/unit/renderer/components/ControlProfilePanel.test.tsx`:

```ts
it('selects a J-Link target from the installed SEGGER catalog before saving', async () => {
  mock.spies.jlinkDevices.search.mockResolvedValue({
    success: true,
    data: {
      available: true,
      sourceFiles: ['D:/Program Files/SEGGER/JLink/JLinkDevices.xml'],
      devices: [
        { name: '-AT32F435RGT7', vendor: 'ArteryTek', core: 'JLINK_CORE_CORTEX_M4', sourceFile: 'JLinkDevices.xml', flashBanks: [] },
      ],
    },
  });
  mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({ success: true, data: { root: 'C:/repo' } });
  mock.spies.controlProfile.save.mockResolvedValueOnce({
    success: true,
    data: {
      path: 'C:/repo/.linkterm/control-profile.json',
      profile: {
        schemaVersion: 'linkterm-control/1.0.0',
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' },
        jlink: { enabled: true, target: '-AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
        flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      },
    },
  });

  render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

  fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
  await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
  fireEvent.change(screen.getByLabelText('J-Link device name'), { target: { value: 'AT32F435' } });
  expect(await screen.findByRole('button', { name: /-AT32F435RGT7/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /-AT32F435RGT7/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save to workspace' }));

  await waitFor(() =>
    expect(mock.spies.controlProfile.save).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        jlink: expect.objectContaining({ target: '-AT32F435RGT7' }),
      }),
    })),
  );
});

it('allows manual fallback but marks the target as not confirmed by the local catalog', async () => {
  mock.spies.jlinkDevices.search.mockResolvedValue({
    success: true,
    data: { available: true, sourceFiles: ['JLinkDevices.xml'], devices: [] },
  });

  render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

  fireEvent.change(screen.getByLabelText('J-Link device name'), { target: { value: 'CUSTOM_DEVICE' } });

  expect(await screen.findByText(/not found in the local SEGGER device catalog/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run failing UI tests**

Run:

```bash
pnpm exec vitest run tests/unit/renderer/components/ControlProfilePanel.test.tsx
```

Expected: FAIL because `jlinkDevices` mock/API and UI selector behavior are missing.

- [ ] **Step 4: Implement UI behavior**

In `ControlProfilePanel.tsx`:

- Keep `target` as the saved value.
- Add state:

```ts
const [targetQuery, setTargetQuery] = React.useState('');
const [deviceOptions, setDeviceOptions] = React.useState<ReadonlyArray<JLinkDeviceInfoPayload>>([]);
const [deviceCatalogAvailable, setDeviceCatalogAvailable] = React.useState<boolean | null>(null);
const [searchingDevices, setSearchingDevices] = React.useState(false);
const [selectedCatalogTarget, setSelectedCatalogTarget] = React.useState<string | null>(null);
```

- Replace `updateTarget` so typing searches `api.jlinkDevices.search({ query: value, limit: 8 })` after trimming.
- On successful search:
  - set options from `result.data.devices`
  - set availability from `result.data.available`
  - keep STM32 normalization fallback only when no exact catalog match was selected.
- Render a compact option list under the input:
  - Each option is a button with device `name`, `vendor`, `core`.
  - Clicking an option sets `target`, `targetQuery`, `selectedCatalogTarget`.
- If catalog is available and query has no results, show the manual fallback warning.
- Save path:
  - If `selectedCatalogTarget` is set, save it exactly.
  - Else use `classifyJLinkTargetName(targetQuery || target).normalizedTarget` as fallback.

Do not add a landing/help card. Keep the current dense dialog layout.

Add i18n keys:

```ts
'controlProfile.target.catalogSearching': 'Searching installed SEGGER devices...',
'controlProfile.target.catalogUnavailable': 'SEGGER device catalog was not found; manual target entry is allowed.',
'controlProfile.target.manualWarning': 'This target was not found in the local SEGGER device catalog. Automation may refuse flashing until the device pack is installed or the target name is corrected.',
'controlProfile.target.source': 'SEGGER catalog',
```

Chinese equivalents:

```ts
'controlProfile.target.catalogSearching': '正在搜索本机 SEGGER 设备库...',
'controlProfile.target.catalogUnavailable': '未找到 SEGGER 设备库；仍可手动输入目标名。',
'controlProfile.target.manualWarning': '本机 SEGGER 设备库中未找到该目标名。安装匹配 device pack 或修正目标名之前，自动烧录可能会拒绝执行。',
'controlProfile.target.source': 'SEGGER 设备库',
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
pnpm exec vitest run tests/unit/renderer/components/ControlProfilePanel.test.tsx
```

Expected: PASS.

---

### Task 4: MCP Catalog Tools And Profile Diagnostics

**Files:**
- Create: `src/mcp/surfaces/jlink-device-catalog/schemas.ts`
- Create: `src/mcp/surfaces/jlink-device-catalog/tools.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/surfaces/control-profile/tools.ts`
- Test: `tests/unit/mcp/jlink-device-catalog-tools.test.ts`
- Test: `tests/unit/mcp/control-profile-tools.test.ts`

- [ ] **Step 1: Run GitNexus impact**

Run:

```text
impact({ repo: "link-mcp", target: "createMcpServer", direction: "upstream", summaryOnly: true })
impact({ repo: "link-mcp", target: "registerControlProfileTools", direction: "upstream", summaryOnly: true })
```

If HIGH/CRITICAL, report before editing.

- [ ] **Step 2: Write failing MCP tool tests**

Create `tests/unit/mcp/jlink-device-catalog-tools.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import type { JLinkDeviceCatalog } from '@/jlink/device-catalog.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';

function makeCatalog(): JLinkDeviceCatalog {
  return {
    search: async () => ({
      available: true,
      sourceFiles: ['JLinkDevices.xml'],
      devices: [{ name: '-AT32F435RGT7', vendor: 'ArteryTek', sourceFile: 'JLinkDevices.xml', flashBanks: [] }],
    }),
    get: async (name) => name === '-AT32F435RGT7'
      ? { name, vendor: 'ArteryTek', sourceFile: 'JLinkDevices.xml', flashBanks: [] }
      : undefined,
    has: async (name) => name === '-AT32F435RGT7',
    refresh: async () => undefined,
  };
}

describe('MCP J-Link device catalog tools', () => {
  let manager: SessionManager;
  let serialDiscovery: SerialDiscovery;
  let mcp: LinkTermMcpServer;
  let client: Client;

  beforeEach(async () => {
    manager = new SessionManager();
    serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
    const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
    mcp = createMcpServer({
      sessionManager: manager,
      serialDiscovery,
      jlinkDeviceCatalog: makeCatalog(),
      transportFactory: () => serverTransport,
    });
    await mcp.start();
    client = new Client({ name: 'lt-test-client', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close().catch(() => undefined);
    await mcp.stop();
    await manager.destroyAll();
    serialDiscovery.dispose();
  });

  it('exposes catalog search and get tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining([
      'jlink_device_catalog_search',
      'jlink_device_catalog_get',
    ]));
  });

  it('searches installed J-Link devices', async () => {
    const out = await client.callTool({ name: 'jlink_device_catalog_search', arguments: { query: 'AT32F435' } });
    const data = out.structuredContent as { success: boolean; evidence: { data: { devices: Array<{ name: string }> } } };
    expect(data.success).toBe(true);
    expect(data.evidence.data.devices[0]?.name).toBe('-AT32F435RGT7');
  });

  it('returns NOT_FOUND for an unknown exact device', async () => {
    const out = await client.callTool({ name: 'jlink_device_catalog_get', arguments: { name: 'NOPE' } });
    const data = out.structuredContent as { success: boolean; error: { code: string } };
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });
});
```

Append to `tests/unit/mcp/control-profile-tools.test.ts`:

```ts
it('inspect_control_profile reports catalog suggestions for unknown J-Link targets', async () => {
  h = await setup({
    jlinkDeviceCatalog: {
      search: async () => ({
        available: true,
        sourceFiles: ['JLinkDevices.xml'],
        devices: [{ name: 'STM32H743II', vendor: 'ST', sourceFile: 'JLinkDevices.xml', flashBanks: [] }],
      }),
      get: async () => undefined,
      has: async () => false,
      refresh: async () => undefined,
    },
  });
  await mkdir(path.join(h.root, '.linkterm'), { recursive: true });
  await writeFile(path.join(h.root, '.linkterm', 'control-profile.json'), JSON.stringify({
    schemaVersion: 'linkterm-control/1.0.0',
    jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
  }));

  const out = await callTool(h.client, 'inspect_control_profile', { root: h.root });
  const data = (out.evidence as { data: { diagnostics: Array<{ id: string; suggestions?: Array<{ name: string }> }> } }).data;
  expect(data.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'jlink-target-catalog',
      status: 'warn',
      suggestions: [expect.objectContaining({ name: 'STM32H743II' })],
    }),
  ]));
});
```

If the existing `setup()` helper does not accept `jlinkDeviceCatalog`, extend it.

- [ ] **Step 3: Run failing MCP tests**

Run:

```bash
pnpm exec vitest run tests/unit/mcp/jlink-device-catalog-tools.test.ts tests/unit/mcp/control-profile-tools.test.ts
```

Expected: FAIL because tools and diagnostics are missing.

- [ ] **Step 4: Implement MCP catalog tools**

Create schemas:

```ts
import { z } from 'zod';

export const jlinkDeviceCatalogSearchInputSchema = {
  query: z.string().optional(),
  vendor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

export const jlinkDeviceCatalogGetInputSchema = {
  name: z.string().min(1),
};
```

Create tools:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JLinkDeviceCatalog } from '../../../jlink/device-catalog.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { registerTool, ToolError, type ToolHandlerResult } from '../../registry.js';
import { jlinkDeviceCatalogGetInputSchema, jlinkDeviceCatalogSearchInputSchema } from './schemas.js';

export function registerJLinkDeviceCatalogTools(server: McpServer, catalog: JLinkDeviceCatalog): void {
  registerTool(server, {
    name: 'jlink_device_catalog_search',
    description: 'Search installed SEGGER J-Link device database entries. Use this before writing jlink.target.',
    sensitivity: 'read-only',
    inputSchema: jlinkDeviceCatalogSearchInputSchema,
    handler: async (input): Promise<ToolHandlerResult> => {
      const result = await catalog.search(input);
      return { success: true, evidence: { kind: 'debug_output', data: result, cursor: 0 } };
    },
  });
  registerTool(server, {
    name: 'jlink_device_catalog_get',
    description: 'Get one installed SEGGER J-Link device database entry by exact registered name.',
    sensitivity: 'read-only',
    inputSchema: jlinkDeviceCatalogGetInputSchema,
    handler: async (input): Promise<ToolHandlerResult> => {
      const device = await catalog.get(input.name);
      if (device === undefined) throw new ToolError(ERROR_CODES.NOT_FOUND, `J-Link device not found in installed SEGGER catalog: ${input.name}`);
      return { success: true, evidence: { kind: 'debug_output', data: { device }, cursor: 0 } };
    },
  });
}
```

If `ERROR_CODES.NOT_FOUND` does not exist, add a shared error code or use the existing closest not-found code and assert that in tests.

Modify `CreateMcpServerOptions`:

```ts
jlinkDeviceCatalog?: JLinkDeviceCatalog;
```

Register catalog tools only when provided:

```ts
if (options.jlinkDeviceCatalog) registerJLinkDeviceCatalogTools(server, options.jlinkDeviceCatalog);
```

Pass catalog into `registerControlProfileTools`.

Extend `ControlProfileToolsDeps`:

```ts
jlinkDeviceCatalog?: JLinkDeviceCatalog;
```

In `inspectControlProfileDiagnostics`, if catalog exists and target exists:

- `await catalog.has(normalizedTarget)`
- If false, `await catalog.search({ query: target, limit: 5 })`
- Push diagnostic:

```ts
{
  id: 'jlink-target-catalog',
  status: 'warn',
  message: `J-Link target ${target} is not in the installed SEGGER device catalog.`,
  suggestions: result.devices.slice(0, 5),
}
```

- [ ] **Step 5: Run MCP tests**

Run:

```bash
pnpm exec vitest run tests/unit/mcp/jlink-device-catalog-tools.test.ts tests/unit/mcp/control-profile-tools.test.ts
```

Expected: PASS.

---

### Task 5: High-Impact Workflow And RTT Catalog Guard

**Files:**
- Modify: `src/mcp/surfaces/control-workflow/workflow-runner.ts`
- Modify: `src/main/ipc/rtt-log-session-ipc.ts`
- Modify: `src/main/ipc/index.ts`
- Test: `tests/unit/mcp/control-workflow-tools.test.ts`
- Test: `tests/unit/main/ipc/rtt-log-session-ipc.test.ts`

- [ ] **Step 1: Run GitNexus impact**

Run:

```text
impact({ repo: "link-mcp", target: "runControlWorkflow", direction: "upstream", summaryOnly: true })
impact({ repo: "link-mcp", target: "registerRttLogSessionIpc", direction: "upstream", summaryOnly: true })
impact({ repo: "link-mcp", target: "registerIpcHandlers", direction: "upstream", summaryOnly: true })
```

If HIGH/CRITICAL, report before editing.

- [ ] **Step 2: Write failing guard tests**

Append to `tests/unit/mcp/control-workflow-tools.test.ts`:

```ts
it('blocks flash workflow before opening the probe when target is absent from installed SEGGER catalog', async () => {
  h = await setup({
    jlinkDeviceCatalog: {
      search: async () => ({
        available: true,
        sourceFiles: ['JLinkDevices.xml'],
        devices: [{ name: 'STM32H743II', vendor: 'ST', sourceFile: 'JLinkDevices.xml', flashBanks: [] }],
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
    confirm: true,
  });

  const data = (out.evidence as { data: { failedStep?: string; blockingReasons?: Array<{ kind: string; details?: unknown }> } }).data;
  expect(data.failedStep).toBe('preflight');
  expect(data.blockingReasons).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'jlink_target_not_in_catalog' }),
  ]));
  expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
});
```

Append to `tests/unit/main/ipc/rtt-log-session-ipc.test.ts`:

```ts
it('refuses RTT auto-open when profile target is not in the installed SEGGER catalog', async () => {
  const catalog = {
    search: vi.fn(async () => ({ available: true, sourceFiles: ['JLinkDevices.xml'], devices: [] })),
    get: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    refresh: vi.fn(async () => undefined),
  };
  registerRttLogSessionIpc(sessionManager, backend, controlProfileManager, catalog);
  await controlProfileManager.init(root, {
    jlink: { enabled: true, target: 'BAD_TARGET', interface: 'swd', speedKHz: 4000 },
    rtt: { enabled: true },
  }, { force: true });

  const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;
  const result = await handler({}, { root }) as { success: boolean; error?: { code: string; message: string } };

  expect(result.success).toBe(false);
  expect(result.error?.message).toContain('SEGGER device catalog');
  expect(backend.callsOf('probeConnect')).toHaveLength(0);
});
```

Adjust helper variable names to match the existing test harness.

- [ ] **Step 3: Run failing guard tests**

Run:

```bash
pnpm exec vitest run tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/rtt-log-session-ipc.test.ts
```

Expected: FAIL because catalog guard is not wired.

- [ ] **Step 4: Implement catalog guard**

Modify `ControlWorkflowRunnerDeps`:

```ts
jlinkDeviceCatalog?: JLinkDeviceCatalog;
```

In `preflight`, before Commander/GDB availability and before any probe connection for high-impact modes:

```ts
await validateCatalogTargetIfAvailable(ctx, deps.jlinkDeviceCatalog);
if (ctx.failedStep !== undefined) return undefined;
```

Implement helper:

```ts
async function validateCatalogTargetIfAvailable(ctx: WorkflowContext, catalog: JLinkDeviceCatalog | undefined): Promise<void> {
  if (catalog === undefined) return;
  const originalTarget = ctx.profile.jlink?.target;
  if (originalTarget === undefined) return;
  const target = normalizeJLinkTargetName(originalTarget);
  const search = await catalog.search({ query: target, limit: 5 });
  if (!search.available) return;
  if (await catalog.has(target)) return;
  addBlockingReason(ctx, {
    kind: 'jlink_target_not_in_catalog',
    code: ERROR_CODES.INVALID_ARGUMENT,
    message: `J-Link target ${target} is not in the installed SEGGER device catalog`,
    details: { target, originalTarget, suggestions: search.devices },
  });
  ctx.failedStep = 'preflight';
  ctx.nextActions.push({
    kind: 'user_action',
    message: '请从 LinkTerm 的 J-Link 设备库选择器里选择本机 SEGGER 支持的设备名，或安装匹配芯片的 SEGGER Device Pack/AddOn 后重试。',
  });
  pushStep(ctx, 'preflight', 'failed', { blockingReasons: ctx.blockingReasons }, undefined, {
    code: ERROR_CODES.INVALID_ARGUMENT,
    message: `J-Link target ${target} is not in the installed SEGGER device catalog`,
    details: { target, suggestions: search.devices },
  });
}
```

Modify `registerControlWorkflowTools` deps and server wiring to pass catalog.

Modify `registerRttLogSessionIpc` signature to accept optional catalog and validate before `jlinkBackend.probeConnect`.

In `src/main/ipc/index.ts`, pass the same `jlinkDeviceCatalog` into:

- `registerRttLogSessionIpc`
- `createMcpServer`
- `startMcpHttpRuntimeServer` if its options need matching support.

- [ ] **Step 5: Run guard tests**

Run:

```bash
pnpm exec vitest run tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/rtt-log-session-ipc.test.ts
```

Expected: PASS.

---

### Task 6: Verification And Risk Review

**Files:**
- No new source files unless a prior task requires a small fix.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
pnpm exec vitest run tests/unit/jlink/device-catalog.test.ts tests/unit/main/ipc/jlink-device-catalog-ipc.test.ts tests/unit/renderer/components/ControlProfilePanel.test.tsx tests/unit/mcp/jlink-device-catalog-tools.test.ts tests/unit/mcp/control-profile-tools.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/rtt-log-session-ipc.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm test
pnpm run build:main
pnpm run lint
```

Expected: all PASS. Vite chunk warnings are acceptable only if existing commands already emit them.

- [ ] **Step 3: Run GitNexus detect changes**

Run:

```text
detect_changes({ repo: "link-mcp", scope: "all" })
```

Expected affected areas:

- J-Link catalog parsing/search
- Control profile UI target selection
- IPC/preload jlinkDevices namespace
- MCP catalog tools
- Control profile diagnostics
- Control workflow/RTT catalog preflight

If risk is HIGH or CRITICAL, final report must call it out with affected flows.

- [ ] **Step 4: Manual smoke checks**

Run these local smoke checks on Windows:

```bash
pnpm exec tsx -e "import { createJLinkDeviceCatalog } from './src/jlink/device-catalog.ts'; const c=createJLinkDeviceCatalog(); console.log(await c.search({query:'STM32H743',limit:5}));"
pnpm exec tsx -e "import { createJLinkDeviceCatalog } from './src/jlink/device-catalog.ts'; const c=createJLinkDeviceCatalog(); console.log(await c.search({query:'AT32F435',limit:5}));"
```

Expected:

- First command returns installed STM32 candidates if supported by local SEGGER.
- Second command returns installed ArteryTek/AddOn candidates if present, preserving names with leading `-`.

## Final Report Requirements

Final answer must concisely list:

- Implemented behavior.
- Key files changed.
- Verification commands and results.
- GitNexus risk level and affected flows if HIGH/CRITICAL.
- Any remaining manual step, such as installing SEGGER Device Pack/AddOn when a target is absent from the local catalog.
