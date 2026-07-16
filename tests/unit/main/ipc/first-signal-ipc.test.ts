import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  FirstSignalEventSchema,
  FirstSignalObservationSchema,
  type FirstSignalObservation,
  type FirstSignalStartRequest,
  type FirstSignalStartResult,
  type FirstSignalStatusRequest,
  type FirstSignalStatusResult,
  type FirstSignalStopRequest,
  type FirstSignalStopResult,
} from '../../../../src/shared/first-signal-contract.js';
import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';

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

class WebContentsMock extends EventEmitter {
  readonly sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];
  readonly send = vi.fn((channel: string, payload: unknown): void => {
    if (this.throwOnSend) throw new Error('webContents send failed');
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

  firstSignalEvents(): readonly FirstSignalObservation[] {
    return this.sent
      .filter((entry) => entry.channel === IPC_CHANNELS.FIRST_SIGNAL_EVENT)
      .map((entry) => FirstSignalEventSchema.parse(entry.payload).observation);
  }
}

interface FirstSignalIpcServiceLike {
  start(req: FirstSignalStartRequest): FirstSignalStartResult;
  status(req: FirstSignalStatusRequest): FirstSignalStatusResult;
  stop(req: FirstSignalStopRequest): FirstSignalStopResult;
  onObservation(listener: (observation: FirstSignalObservation) => void): () => void;
}

let registerFirstSignalIpc: typeof import('../../../../src/main/ipc/first-signal-ipc.js').registerFirstSignalIpc;

function observation(
  revision = 1,
  state: FirstSignalObservation['state'] = 'waiting',
): FirstSignalObservation {
  return FirstSignalObservationSchema.parse({
    schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
    attemptId: 'attempt_1',
    clientAttemptKey: 'client_1',
    revision,
    sessionId: 'sess_1',
    ownsSession: true,
    baselineCursor: 0,
    state,
    startedAt: '2026-07-13T04:00:00.000Z',
    updatedAt: `2026-07-13T04:00:${String(revision).padStart(2, '0')}.000Z`,
    timeoutMs: 1_000,
    ...(state === 'signal-detected'
      ? {
          observedAt: '2026-07-13T04:00:02.000Z',
          observedSequence: 7,
        }
      : {}),
  });
}

function createService(): FirstSignalIpcServiceLike & {
  readonly listeners: Set<(observation: FirstSignalObservation) => void>;
  readonly start: ReturnType<typeof vi.fn>;
  readonly status: ReturnType<typeof vi.fn>;
  readonly stop: ReturnType<typeof vi.fn>;
  emit(observation: FirstSignalObservation): void;
} {
  const listeners = new Set<(next: FirstSignalObservation) => void>();
  const service = {
    listeners,
    start: vi.fn((req: FirstSignalStartRequest) => ({
      success: true,
      data: observation(1, req.clientAttemptKey === 'client_detected' ? 'signal-detected' : 'waiting'),
    })),
    status: vi.fn(() => ({ success: true, data: observation(1) })),
    stop: vi.fn((req: FirstSignalStopRequest) => ({
      success: true,
      data: FirstSignalObservationSchema.parse({
        ...observation(2),
        state: 'stopped',
        stopReason: req.reason,
      }),
    })),
    onObservation: vi.fn((listener: (next: FirstSignalObservation) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(next: FirstSignalObservation) {
      for (const listener of listeners) listener(next);
    },
  };
  return service;
}

function firstSignalHandler(channel: string): (sender: WebContentsMock, raw?: unknown) => unknown {
  const handler = handlers.get(channel);
  if (handler === undefined) throw new Error(`Missing handler for ${channel}`);
  return (sender, raw) => handler({ sender }, raw);
}

describe('registerFirstSignalIpc', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ registerFirstSignalIpc } = await import('../../../../src/main/ipc/first-signal-ipc.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('registers lifecycle handlers and disposes them', () => {
    const service = createService();
    const dispose = registerFirstSignalIpc(service);

    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIRST_SIGNAL_START,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIRST_SIGNAL_STATUS,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIRST_SIGNAL_STOP,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.FIRST_SIGNAL_UNSUBSCRIBE,
      expect.any(Function),
    );

    dispose();

    expect(handlers.has(IPC_CHANNELS.FIRST_SIGNAL_START)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.FIRST_SIGNAL_STATUS)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.FIRST_SIGNAL_STOP)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.FIRST_SIGNAL_UNSUBSCRIBE)).toBe(false);
    expect(service.listeners.size).toBe(0);
  });

  it('validates start/status/stop requests and never exposes raw malformed payloads', () => {
    const service = createService();
    const sender = new WebContentsMock(1);
    registerFirstSignalIpc(service);

    expect(
      firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_START)(sender, {
        schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
        clientAttemptKey: 'client_1',
        sessionId: 'sess_1',
        ownsSession: true,
        baselineCursor: 0,
        timeoutMs: 1_000,
      }),
    ).toMatchObject({ success: true, data: { attemptId: 'attempt_1' } });
    expect(firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_STATUS)(sender, { attemptId: 'attempt_1' }))
      .toMatchObject({ success: true, data: { revision: 1 } });
    expect(
      firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_STOP)(sender, {
        attemptId: 'attempt_1',
        reason: 'back-to-session',
      }),
    ).toMatchObject({ success: true, data: { state: 'stopped', stopReason: 'back-to-session' } });

    expect(firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_START)(sender, null)).toEqual({
      success: false,
      error: { code: 'firstSignal.invalid_request', message: 'Invalid first-signal request' },
    });
    expect(
      firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_STOP)(sender, {
        attemptId: 'attempt_1',
        reason: 'C:/Users/Admin/token',
      }),
    ).toEqual({
      success: false,
      error: { code: 'firstSignal.invalid_request', message: 'Invalid first-signal request' },
    });
    expect(JSON.stringify(sender.sent)).not.toMatch(/token|Users|stack/i);
  });

  it('installs destroyed-window cleanup before status hydration and pushes only matching attempt events', () => {
    const service = createService();
    const sender = new WebContentsMock(2);
    const order: string[] = [];
    const originalOnce = sender.once.bind(sender);
    sender.once = ((eventName: string | symbol, listener: (...args: unknown[]) => void) => {
      if (eventName === 'destroyed') order.push('cleanup-listener');
      return originalOnce(eventName, listener);
    }) as WebContentsMock['once'];
    service.status.mockImplementation((req: FirstSignalStatusRequest) => {
      order.push(`status:${req.attemptId}`);
      return { success: true, data: observation(1) };
    });

    registerFirstSignalIpc(service);
    expect(
      firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE)(sender, {
        attemptId: 'attempt_1',
        sinceRevision: 0,
      }),
    ).toMatchObject({ success: true, data: { attemptId: 'attempt_1' } });

    service.emit(observation(2, 'signal-detected'));
    service.emit({ ...observation(3, 'signal-detected'), attemptId: 'attempt_2' });

    expect(order).toEqual(['cleanup-listener', 'status:attempt_1']);
    expect(sender.firstSignalEvents().map((event) => event.revision)).toEqual([2]);
  });

  it('cleans subscribers on explicit unsubscribe, destroyed windows, and send races', () => {
    const service = createService();
    const senderA = new WebContentsMock(10);
    const senderB = new WebContentsMock(11);
    const throwing = new WebContentsMock(12);
    registerFirstSignalIpc(service);

    firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE)(senderA, { attemptId: 'attempt_1' });
    firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE)(senderB, { attemptId: 'attempt_1' });
    firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE)(throwing, { attemptId: 'attempt_1' });
    throwing.throwOnSend = true;

    service.emit(observation(2, 'signal-detected'));
    expect(senderA.firstSignalEvents()).toHaveLength(1);
    expect(senderB.firstSignalEvents()).toHaveLength(1);
    expect(throwing.send).toHaveBeenCalledTimes(1);

    expect(firstSignalHandler(IPC_CHANNELS.FIRST_SIGNAL_UNSUBSCRIBE)(senderA, {})).toEqual({
      success: true,
      data: { unsubscribed: true },
    });
    senderB.destroy();
    service.emit(observation(3, 'signal-detected'));

    expect(senderA.firstSignalEvents()).toHaveLength(1);
    expect(senderB.firstSignalEvents()).toHaveLength(1);
    expect(throwing.send).toHaveBeenCalledTimes(1);
  });
});
