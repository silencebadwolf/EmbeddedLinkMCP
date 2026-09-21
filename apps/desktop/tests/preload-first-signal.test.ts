import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  FirstSignalObservationSchema,
  type FirstSignalEvent,
  type FirstSignalObservation,
} from '@linkterm/contracts/first-signal-contract';
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

function observation(revision = 1): FirstSignalObservation {
  return FirstSignalObservationSchema.parse({
    schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
    attemptId: 'attempt_1',
    clientAttemptKey: 'client_1',
    revision,
    sessionId: 'sess_1',
    ownsSession: true,
    baselineCursor: 0,
    state: 'waiting',
    startedAt: '2026-07-13T05:00:00.000Z',
    updatedAt: `2026-07-13T05:00:${String(revision).padStart(2, '0')}.000Z`,
    timeoutMs: 1_000,
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

describe('preload firstSignal namespace', () => {
  beforeEach(() => {
    delete globalThis.__linktermElectronMock;
  });

  it('exposes only the narrow firstSignal namespace, not ipcRenderer', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);

    expect(api).not.toHaveProperty('ipcRenderer');
    expect(api.firstSignal).toEqual({
      start: expect.any(Function),
      status: expect.any(Function),
      stop: expect.any(Function),
      subscribe: expect.any(Function),
      unsubscribe: expect.any(Function),
      onEvent: expect.any(Function),
    });
  });

  it('invokes start/status/stop/subscribe/unsubscribe through first-signal channels with strict parsing', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const current = observation(1);

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: current });
    await expect(
      api.firstSignal.start({
        schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
        clientAttemptKey: 'client_1',
        sessionId: 'sess_1',
        ownsSession: true,
        baselineCursor: 0,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({ success: true, data: current });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.FIRST_SIGNAL_START,
      expect.objectContaining({ clientAttemptKey: 'client_1' }),
    );

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: current });
    await expect(api.firstSignal.status({ attemptId: 'attempt_1' })).resolves.toEqual({
      success: true,
      data: current,
    });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.FIRST_SIGNAL_STATUS, {
      attemptId: 'attempt_1',
    });

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: current });
    await expect(
      api.firstSignal.stop({ attemptId: 'attempt_1', reason: 'back-to-session' }),
    ).resolves.toEqual({ success: true, data: current });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.FIRST_SIGNAL_STOP, {
      attemptId: 'attempt_1',
      reason: 'back-to-session',
    });

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: current });
    await expect(api.firstSignal.subscribe({ attemptId: 'attempt_1' })).resolves.toEqual({
      success: true,
      data: current,
    });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE, {
      attemptId: 'attempt_1',
    });

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: { unsubscribed: true } });
    await expect(api.firstSignal.unsubscribe()).resolves.toEqual({
      success: true,
      data: { unsubscribed: true },
    });
    expect(mock.ipcRenderer.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.FIRST_SIGNAL_UNSUBSCRIBE,
      {},
    );
  });

  it('maps malformed first-signal invoke responses to a stable local invalid-payload failure', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const invalidPayload = {
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid first-signal payload' },
    };

    mock.ipcRenderer.invoke.mockResolvedValueOnce({
      success: true,
      data: observation(),
      rawStack: 'C:/Users/Admin/private/token',
    });
    await expect(api.firstSignal.status({ attemptId: 'attempt_1' })).resolves.toEqual(invalidPayload);

    mock.ipcRenderer.invoke.mockResolvedValueOnce({ success: true, data: { nope: true } });
    await expect(api.firstSignal.unsubscribe()).resolves.toEqual(invalidPayload);
  });

  it('parses pushed first-signal events and surfaces invalid pushes as bounded diagnostics', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);
    const received: FirstSignalEvent[] = [];
    const diagnostics: string[] = [];

    const unsubscribe = api.firstSignal.onEvent(
      (event) => received.push(event),
      (diagnostic) => diagnostics.push(`${diagnostic.code}:${diagnostic.severity}`),
    );
    mock.emit(IPC_CHANNELS.FIRST_SIGNAL_EVENT, {
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      observation: observation(2),
    });
    mock.emit(IPC_CHANNELS.FIRST_SIGNAL_EVENT, {
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      observation: { rawStack: 'C:/Users/Admin/private/token' },
    });

    expect(received.map((event) => event.observation.revision)).toEqual([2]);
    expect(diagnostics).toEqual(['firstSignal.invalid_payload:error']);
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|token|rawStack/i);

    unsubscribe();
    mock.emit(IPC_CHANNELS.FIRST_SIGNAL_EVENT, {
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      observation: observation(3),
    });
    expect(received.map((event) => event.observation.revision)).toEqual([2]);
    expect(mock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.FIRST_SIGNAL_EVENT,
      expect.any(Function),
    );
  });
});
