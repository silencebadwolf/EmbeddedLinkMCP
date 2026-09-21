import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  READINESS_SCHEMA_VERSION,
  ReadinessEventSchema,
  RuntimeReadinessSnapshotSchema,
  type RuntimeReadinessSnapshot,
} from '@linkterm/contracts/readiness-contract';
import { IPC_CHANNELS } from '../../src/ipc/channels.js';

const { handlers, ipcMainMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMainMock: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
    },
  };
});

const electronMock = { app: {}, ipcMain: ipcMainMock };
globalThis.__linktermElectronMock = electronMock;

vi.mock('electron', () => ({ default: electronMock, ...electronMock }));

interface ReadinessSuccess<T> {
  readonly success: true;
  readonly data: T;
}

interface ReadinessFailure {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

interface ReadinessServiceLike {
  getCurrent(): RuntimeReadinessSnapshot;
  refresh(): Promise<RuntimeReadinessSnapshot>;
}

class WebContentsMock extends EventEmitter {
  readonly sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];
  readonly send = vi.fn((channel: string, payload: unknown): void => {
    if (this.throwOnSend) {
      throw new Error('webContents send failed');
    }
    this.sent.push({ channel, payload });
  });

  #destroyed = false;
  throwOnSend = false;

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.emit('destroyed');
  }

  readinessEvents(): readonly RuntimeReadinessSnapshot[] {
    return this.sent
      .filter((entry) => entry.channel === IPC_CHANNELS.READINESS_EVENT)
      .map((entry) => ReadinessEventSchema.parse(entry.payload).snapshot);
  }
}

let registerReadinessIpc: typeof import('../../src/main/ipc/readiness-ipc.js').registerReadinessIpc;

function snapshot(generation: number, status: RuntimeReadinessSnapshot['status'] = 'ready') {
  const checkedAt = `2026-07-13T01:00:${String(generation).padStart(2, '0')}.000Z`;
  return RuntimeReadinessSnapshotSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    snapshotId: `readiness_${generation}`,
    generation,
    status,
    generatedAt: checkedAt,
    checks: [
      {
        id: 'runtime',
        scope: 'runtime',
        status,
        severity: 'info',
        summaryCode: status === 'ready' ? 'readiness.runtime.ready' : 'readiness.runtime.stale',
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

function createService(): ReadinessServiceLike & {
  current: RuntimeReadinessSnapshot;
  readonly getCurrent: ReturnType<typeof vi.fn>;
  readonly refresh: ReturnType<typeof vi.fn>;
} {
  const service = {
    current: snapshot(0),
    getCurrent: vi.fn(() => service.current),
    refresh: vi.fn(async () => {
      service.current = snapshot(service.current.generation + 1);
      return service.current;
    }),
  };
  return service;
}

function readinessHandler(channel: string): (sender: WebContentsMock, raw?: unknown) => unknown {
  const handler = handlers.get(channel);
  if (handler === undefined) throw new Error(`Missing handler for ${channel}`);
  return (sender, raw) => handler({ sender }, raw);
}

function successData<T>(result: unknown): T {
  expect(result).toMatchObject({ success: true });
  return (result as ReadinessSuccess<T>).data;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('registerReadinessIpc', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ registerReadinessIpc } = await import('../../src/main/ipc/readiness-ipc.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('registers get, refresh, subscribe, and unsubscribe handlers and disposes subscribers', () => {
    const service = createService();
    const sender = new WebContentsMock(1);
    const dispose = registerReadinessIpc(service);

    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.READINESS_GET,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.READINESS_REFRESH,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.READINESS_SUBSCRIBE,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.READINESS_UNSUBSCRIBE,
      expect.any(Function),
    );
    expect(handlers.has(IPC_CHANNELS.READINESS_EVENT)).toBe(false);

    successData(readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(sender, {}));
    dispose();

    expect(sender.readinessEvents()).toHaveLength(0);
    expect(handlers.has(IPC_CHANNELS.READINESS_GET)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.READINESS_REFRESH)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.READINESS_SUBSCRIBE)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.READINESS_UNSUBSCRIBE)).toBe(false);
  });

  it('installs the destroyed-window cleanup listener before returning the subscription snapshot', () => {
    const service = createService();
    const sender = new WebContentsMock(2);
    const order: string[] = [];
    const originalOnce = sender.once.bind(sender);
    const getCurrent = vi.spyOn(service, 'getCurrent');
    sender.once = ((eventName: string | symbol, listener: (...args: unknown[]) => void) => {
      if (eventName === 'destroyed') order.push('cleanup-listener');
      return originalOnce(eventName, listener);
    }) as WebContentsMock['once'];
    getCurrent.mockImplementation(() => {
      order.push('snapshot');
      return service.current;
    });

    registerReadinessIpc(service);
    const result = successData<RuntimeReadinessSnapshot>(
      readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(sender, {}),
    );

    expect(result.generation).toBe(0);
    expect(order).toEqual(['cleanup-listener', 'snapshot']);
    expect(sender.listenerCount('destroyed')).toBe(1);
  });

  it('returns current snapshots and pushes display-safe refresh events to subscribers', async () => {
    const service = createService();
    const sender = new WebContentsMock(3);
    registerReadinessIpc(service);

    const initial = successData<RuntimeReadinessSnapshot>(
      readinessHandler(IPC_CHANNELS.READINESS_GET)(sender, {}),
    );
    successData(readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(sender, {}));
    const refreshed = successData<RuntimeReadinessSnapshot>(
      await readinessHandler(IPC_CHANNELS.READINESS_REFRESH)(sender, {}),
    );

    expect(initial.generation).toBe(0);
    expect(refreshed.generation).toBe(1);
    expect(sender.readinessEvents().map((event) => event.generation)).toEqual([1]);
    expect(JSON.stringify(sender.sent)).not.toMatch(/stack|token|secret|C:\\\\Users/i);
  });

  it('rejects malformed requests and cursors without subscribing or refreshing', async () => {
    const service = createService();
    const sender = new WebContentsMock(4);
    registerReadinessIpc(service);

    const malformedGet = readinessHandler(IPC_CHANNELS.READINESS_GET)(sender, null) as ReadinessFailure;
    const malformedRefresh = (await readinessHandler(IPC_CHANNELS.READINESS_REFRESH)(sender, {
      unexpected: true,
    })) as ReadinessFailure;
    const malformedCursor = readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(sender, {
      cursor: { snapshotId: 'readiness_0', generation: -1 },
    }) as ReadinessFailure;
    const futureCursor = readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(sender, {
      cursor: { snapshotId: 'readiness_99', generation: 99 },
    }) as ReadinessFailure;

    expect(malformedGet).toMatchObject({
      success: false,
      error: { code: 'INVALID_READINESS_REQUEST', message: 'Invalid readiness request' },
    });
    expect(malformedRefresh).toMatchObject({
      success: false,
      error: { code: 'INVALID_READINESS_REQUEST', message: 'Invalid readiness request' },
    });
    expect(malformedCursor).toMatchObject({
      success: false,
      error: { code: 'INVALID_READINESS_CURSOR', message: 'Invalid readiness cursor' },
    });
    expect(futureCursor).toMatchObject({
      success: false,
      error: { code: 'INVALID_READINESS_CURSOR', message: 'Invalid readiness cursor' },
    });
    expect(service.refresh).not.toHaveBeenCalled();
    expect(sender.listenerCount('destroyed')).toBe(0);
  });

  it('keeps repeat subscribe, explicit unsubscribe, destroyed cleanup, and send races isolated', async () => {
    const service = createService();
    const senderA = new WebContentsMock(10);
    const senderB = new WebContentsMock(11);
    const throwing = new WebContentsMock(12);
    registerReadinessIpc(service);

    successData(readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(senderA, {}));
    successData(readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(senderB, {}));
    successData(readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(throwing, {}));
    successData(readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(senderA, {}));
    expect(senderA.listenerCount('destroyed')).toBe(1);
    throwing.throwOnSend = true;

    await readinessHandler(IPC_CHANNELS.READINESS_REFRESH)(senderA, {});
    const throwingAttempts = throwing.send.mock.calls.length;
    const beforeUnsubscribeB = senderB.readinessEvents().length;
    expect(senderA.readinessEvents()).toHaveLength(1);
    expect(senderB.readinessEvents()).toHaveLength(1);

    expect(readinessHandler(IPC_CHANNELS.READINESS_UNSUBSCRIBE)(senderA, {})).toMatchObject({
      success: true,
      data: { unsubscribed: true },
    });
    senderB.destroy();
    await readinessHandler(IPC_CHANNELS.READINESS_REFRESH)(senderA, {});

    expect(senderA.readinessEvents()).toHaveLength(1);
    expect(senderB.readinessEvents()).toHaveLength(beforeUnsubscribeB);
    expect(throwing.send).toHaveBeenCalledTimes(throwingAttempts);
  });

  it('rejects stale overlapping refresh generations and only emits the latest snapshot', async () => {
    const slow = deferred<RuntimeReadinessSnapshot>();
    const fast = deferred<RuntimeReadinessSnapshot>();
    const service = createService();
    service.refresh.mockImplementationOnce(async () => slow.promise);
    service.refresh.mockImplementationOnce(async () => fast.promise);
    const sender = new WebContentsMock(20);
    registerReadinessIpc(service);
    successData(readinessHandler(IPC_CHANNELS.READINESS_SUBSCRIBE)(sender, {}));

    const first = readinessHandler(IPC_CHANNELS.READINESS_REFRESH)(sender, {}) as Promise<unknown>;
    const second = readinessHandler(IPC_CHANNELS.READINESS_REFRESH)(sender, {}) as Promise<unknown>;
    service.current = snapshot(2);
    fast.resolve(service.current);
    const secondResult = successData<RuntimeReadinessSnapshot>(await second);
    slow.resolve(snapshot(1, 'action-required'));
    const firstResult = (await first) as ReadinessFailure;

    expect(secondResult.generation).toBe(2);
    expect(firstResult).toMatchObject({
      success: false,
      error: { code: 'STALE_READINESS_GENERATION', message: 'Invalid readiness cursor' },
    });
    expect(sender.readinessEvents().map((event) => event.generation)).toEqual([2]);
  });
});
