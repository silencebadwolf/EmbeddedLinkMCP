import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_SCHEMA_VERSION,
  type ActivityEventView,
  type ActivitySnapshotView,
} from '../../../src/shared/activity-contract.js';
import { IPC_CHANNELS } from '../../../src/shared/ipc-protocol.js';
import type { PreloadAPI } from '../../../src/shared/preload-api.js';

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

const ZERO_HEALTH = {
  captureFailureCount: 0,
  droppedEventCount: 0,
  evictedEventCount: 0,
  listenerFailureCount: 0,
  policyFailureCount: 0,
  incompleteLifecycleCount: 0,
} as const;

function emptySnapshot(): ActivitySnapshotView {
  return {
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    cursor: { runtimeId: 'runtime_1', sequence: 0 },
    truncated: false,
    resetRequired: false,
    events: [],
    operations: [],
    calls: [],
    health: ZERO_HEALTH,
  };
}

function operationEvent(): ActivityEventView {
  return {
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    runtimeId: 'runtime_1',
    sequence: 1,
    eventId: 'event_1',
    timestamp: '2026-07-13T00:00:00.000Z',
    operationId: 'operation_1',
    actor: { kind: 'agent', channel: 'local-mcp' },
    surface: 'runtime',
    action: 'get_app_status',
    risk: 'read-only',
    approvalPolicy: 'none',
    authorizationSource: 'none',
    targets: [{ kind: 'runtime', id: 'runtime_1', label: 'current-runtime' }],
    kind: 'operation-transition',
    operationPhase: 'requested',
  };
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
  await import('../../../src/main/preload.js');
  expect(mock.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('linkterm', expect.any(Object));
  return mock.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as PreloadAPI;
}

describe('preload activity namespace', () => {
  beforeEach(() => {
    delete globalThis.__linktermElectronMock;
  });

  it('exposes only the narrow activity namespace, not ipcRenderer', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);

    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api.activity).toEqual({
      subscribe: expect.any(Function),
      snapshot: expect.any(Function),
      unsubscribe: expect.any(Function),
      onEvent: expect.any(Function),
      status: expect.any(Function),
      export: expect.any(Function),
      clear: expect.any(Function),
    });
  });

  it('invokes subscribe, snapshot, and unsubscribe through activity channels with strict parsing', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const snapshot = emptySnapshot();
    const failure = {
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity cursor' },
    } as const;

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: snapshot });
    await expect(api.activity.subscribe({ cursor: snapshot.cursor })).resolves.toEqual({
      success: true,
      data: snapshot,
    });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.ACTIVITY_SUBSCRIBE, {
      cursor: snapshot.cursor,
    });

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: snapshot });
    await expect(api.activity.snapshot()).resolves.toEqual({ success: true, data: snapshot });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.ACTIVITY_SNAPSHOT, {});

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: { unsubscribed: true } });
    await expect(api.activity.unsubscribe()).resolves.toEqual({
      success: true,
      data: { unsubscribed: true },
    });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE, {});

    mock.ipcRenderer.invoke.mockResolvedValueOnce(failure);
    await expect(api.activity.snapshot({ cursor: snapshot.cursor })).resolves.toEqual(failure);
  });

  it('routes status/export/clear through Main and maps malformed results locally', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    mock.ipcRenderer.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        status: {
          schemaVersion: '1.0.0',
          enabled: true,
          retentionDays: 30,
          maxFileBytes: 10 * 1024 * 1024,
          eventCount: 1,
          fileCount: 1,
          byteCount: 10,
          warningCount: 0,
          warnings: [],
          windowsAclDefault: true,
        },
      },
    });
    await expect(api.activity.status()).resolves.toMatchObject({ success: true });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.ACTIVITY_STATUS, {});

    mock.ipcRenderer.invoke.mockResolvedValueOnce({
      success: true,
      data: {
        schemaVersion: '1.0.0',
        fileName: 'activity-export-2026.jsonl',
        format: 'jsonl',
        pathMode: 'basename',
        eventCount: 1,
        redacted: true,
      },
    });
    await expect(api.activity.export({ format: 'jsonl' })).resolves.toMatchObject({ success: true });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.ACTIVITY_EXPORT, {
      format: 'jsonl',
      pathMode: 'basename',
    });

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: { nope: true } });
    await expect(api.activity.clear({ confirm: true })).resolves.toEqual({
      success: false,
      error: { code: 'INVALID_AUDIT_PAYLOAD', message: 'Invalid audit payload' },
    });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.ACTIVITY_CLEAR, { confirm: true });
  });

  it('maps malformed activity invoke responses to the stable local invalid-payload failure', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const invalidPayload = {
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid activity payload' },
    };

    mock.ipcRenderer.invoke.mockResolvedValueOnce({
      success: true,
      data: emptySnapshot(),
      extra: true,
    });
    await expect(api.activity.snapshot()).resolves.toEqual(invalidPayload);

    mock.ipcRenderer.invoke.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity cursor' },
      extra: true,
    });
    await expect(api.activity.subscribe()).resolves.toEqual(invalidPayload);

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: { nope: true } });
    await expect(api.activity.unsubscribe()).resolves.toEqual(invalidPayload);
  });

  it('parses pushed activity events before invoking renderer handlers', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const received: ActivityEventView[] = [];

    const unsubscribe = api.activity.onEvent((event) => received.push(event));
    const event = operationEvent();
    mock.emit(IPC_CHANNELS.ACTIVITY_EVENT, event);
    mock.emit(IPC_CHANNELS.ACTIVITY_EVENT, { ...event, sequence: -1 });

    expect(received).toEqual([event]);

    unsubscribe();
    mock.emit(IPC_CHANNELS.ACTIVITY_EVENT, { ...event, sequence: 2 });
    expect(received).toEqual([event]);
    expect(mock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.ACTIVITY_EVENT,
      expect.any(Function),
    );
  });
});
