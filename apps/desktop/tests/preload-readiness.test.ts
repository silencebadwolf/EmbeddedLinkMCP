import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  READINESS_SCHEMA_VERSION,
  type RuntimeReadinessSnapshot,
  RuntimeReadinessSnapshotSchema,
} from '@linkterm/contracts/readiness-contract';
import { IPC_CHANNELS } from '../src/ipc/channels.js';
import type { PreloadAPI } from '@linkterm/contracts/preload-api';

declare global {
  var __linktermElectronMock: unknown;
}

interface PreloadElectronMock {
  readonly contextBridge: {
    readonly exposeInMainWorld: ReturnType<typeof vi.fn>;
  };
  readonly ipcRenderer: {
    readonly invoke: ReturnType<typeof vi.fn>;
    readonly on: ReturnType<typeof vi.fn>;
    readonly removeListener: ReturnType<typeof vi.fn>;
  };
  readonly emit: (channel: string, payload: unknown) => void;
}

function readinessSnapshot(generation = 0): RuntimeReadinessSnapshot {
  const checkedAt = `2026-07-13T02:00:${String(generation).padStart(2, '0')}.000Z`;
  return RuntimeReadinessSnapshotSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    snapshotId: `readiness_${generation}`,
    generation,
    status: 'ready',
    generatedAt: checkedAt,
    checks: [
      {
        id: 'runtime',
        scope: 'runtime',
        status: 'ready',
        severity: 'info',
        summaryCode: 'readiness.runtime.ready',
        evidence: [],
        recommendedActions: [],
        checkedAt,
      },
    ],
    deviceCandidates: [],
    reusableSessions: [],
    reusableProfiles: [],
    blockers: [],
    diagnostics: [],
  });
}

function createElectronMock(): PreloadElectronMock {
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();
  const ipcRenderer = {
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
    }),
    removeListener: vi.fn(
      (channel: string, listener: (event: unknown, payload: unknown) => void) => {
        listeners.get(channel)?.delete(listener);
      },
    ),
  };
  return {
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer,
    emit: (channel, payload) => {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, payload);
      }
    },
  };
}

async function loadPreload(mock: PreloadElectronMock): Promise<PreloadAPI> {
  globalThis.__linktermElectronMock = mock;
  vi.resetModules();
  await import('../src/preload/index.js');
  expect(mock.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('linkterm', expect.any(Object));
  return mock.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as PreloadAPI;
}

describe('preload readiness namespace', () => {
  beforeEach(() => {
    delete globalThis.__linktermElectronMock;
  });

  it('exposes only the narrow readiness namespace, not ipcRenderer', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);

    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api.readiness).toEqual({
      get: expect.any(Function),
      refresh: expect.any(Function),
      subscribe: expect.any(Function),
      unsubscribe: expect.any(Function),
      onEvent: expect.any(Function),
    });
  });

  it('invokes get, refresh, subscribe, and unsubscribe through readiness channels', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const snapshot = readinessSnapshot(1);

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: snapshot });
    await expect(api.readiness.get()).resolves.toEqual({ success: true, data: snapshot });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.READINESS_GET, {});

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: snapshot });
    await expect(api.readiness.refresh()).resolves.toEqual({ success: true, data: snapshot });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.READINESS_REFRESH, {});

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: snapshot });
    await expect(
      api.readiness.subscribe({ cursor: { snapshotId: snapshot.snapshotId, generation: 1 } }),
    ).resolves.toEqual({ success: true, data: snapshot });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.READINESS_SUBSCRIBE, {
      cursor: { snapshotId: snapshot.snapshotId, generation: 1 },
    });

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: { unsubscribed: true } });
    await expect(api.readiness.unsubscribe()).resolves.toEqual({
      success: true,
      data: { unsubscribed: true },
    });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.READINESS_UNSUBSCRIBE,
      {},
    );
  });

  it('maps malformed readiness invoke responses to a stable local invalid-payload failure', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const invalidPayload = {
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid readiness payload' },
    };

    mock.ipcRenderer.invoke.mockResolvedValueOnce({
      success: true,
      data: readinessSnapshot(),
      extra: true,
    });
    await expect(api.readiness.get()).resolves.toEqual(invalidPayload);

    mock.ipcRenderer.invoke.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_READINESS_CURSOR', message: 'Invalid readiness cursor' },
      extra: true,
    });
    await expect(api.readiness.subscribe()).resolves.toEqual(invalidPayload);

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: { nope: true } });
    await expect(api.readiness.unsubscribe()).resolves.toEqual(invalidPayload);
  });

  it('parses pushed readiness events before invoking renderer handlers', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const received: RuntimeReadinessSnapshot[] = [];
    const snapshot = readinessSnapshot(2);

    const unsubscribe = api.readiness.onEvent((event) => received.push(event.snapshot));
    mock.emit(IPC_CHANNELS.READINESS_EVENT, {
      schemaVersion: READINESS_SCHEMA_VERSION,
      snapshot,
    });
    mock.emit(IPC_CHANNELS.READINESS_EVENT, {
      schemaVersion: READINESS_SCHEMA_VERSION,
      snapshot: { ...snapshot, generation: -1 },
    });

    expect(received).toEqual([snapshot]);

    unsubscribe();
    mock.emit(IPC_CHANNELS.READINESS_EVENT, {
      schemaVersion: READINESS_SCHEMA_VERSION,
      snapshot: readinessSnapshot(3),
    });
    expect(received).toEqual([snapshot]);
    expect(mock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.READINESS_EVENT,
      expect.any(Function),
    );
  });

  it('surfaces malformed pushed readiness events as safe local diagnostics', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const received: RuntimeReadinessSnapshot[] = [];
    const diagnostics: string[] = [];

    api.readiness.onEvent(
      (event) => received.push(event.snapshot),
      (diagnostic) => diagnostics.push(`${diagnostic.code}:${diagnostic.severity}`),
    );
    mock.emit(IPC_CHANNELS.READINESS_EVENT, {
      schemaVersion: READINESS_SCHEMA_VERSION,
      snapshot: { rawStack: 'C:/Users/Admin/private/token' },
    });

    expect(received).toEqual([]);
    expect(diagnostics).toEqual(['readiness.invalid_payload:error']);
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|token|rawStack/i);
  });
});
