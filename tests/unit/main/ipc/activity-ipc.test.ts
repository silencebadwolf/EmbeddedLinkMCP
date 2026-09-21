import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityHealthMonitor } from '@linkterm/runtime/core/activity/activity-health';
import { OperationLedger } from '@linkterm/runtime/core/activity/operation-ledger';
import { OperationRecorder } from '@linkterm/runtime/core/activity/operation-recorder';
import type {
  ActivityCursor,
  ActivityEventView,
} from '../../../../src/shared/activity-contract.js';
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

interface ActivityHarness {
  readonly health: ActivityHealthMonitor;
  readonly ledger: OperationLedger;
  readonly recorder: OperationRecorder;
}

interface ActivitySuccess<T> {
  readonly success: true;
  readonly data: T;
}

interface ActivityFailure {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
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

  activityEvents(): readonly ActivityEventView[] {
    return this.sent
      .filter((entry) => entry.channel === IPC_CHANNELS.ACTIVITY_EVENT)
      .map((entry) => entry.payload as ActivityEventView);
  }
}

let registerActivityIpc: typeof import('../../../../src/main/ipc/activity-ipc.js').registerActivityIpc;

function createHarness(): ActivityHarness {
  let runtimeId = 0;
  let eventId = 0;
  let timestamp = 0;
  const now = () => new Date(Date.UTC(2026, 6, 13, 1, 0, timestamp++)).toISOString();
  const health = new ActivityHealthMonitor(now);
  const ledger = new OperationLedger({
    health,
    createRuntimeId: () => `runtime_${++runtimeId}`,
    createEventId: () => `event_${++eventId}`,
    now,
  });
  return { health, ledger, recorder: new OperationRecorder({ ledger, health }) };
}

function recordMcpLifecycle(
  harness: ActivityHarness,
  action = 'get_app_status',
): readonly ActivityEventView[] {
  const before = harness.ledger.snapshot().cursor;
  const handle = harness.recorder.beginMcpCall({
    action,
    declaredSensitivity: 'read-only',
    rawArgs: {},
  });
  handle.start();
  handle.finishSuccess();
  return harness.ledger.snapshot(before).events;
}

function activityHandler(channel: string): (sender: WebContentsMock, raw?: unknown) => unknown {
  const handler = handlers.get(channel);
  if (handler === undefined) throw new Error(`Missing handler for ${channel}`);
  return (sender, raw) => handler({ sender }, raw);
}

function successData<T>(result: unknown): T {
  expect(result).toMatchObject({ success: true });
  return (result as ActivitySuccess<T>).data;
}

describe('registerActivityIpc', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ registerActivityIpc } = await import('../../../../src/main/ipc/activity-ipc.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('registers the narrow activity channels and disposes handlers plus subscribers', () => {
    const harness = createHarness();
    const sender = new WebContentsMock(1);
    const dispose = registerActivityIpc(harness.ledger);

    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.ACTIVITY_SUBSCRIBE,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.ACTIVITY_SNAPSHOT,
      expect.any(Function),
    );
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE,
      expect.any(Function),
    );
    expect(handlers.has(IPC_CHANNELS.ACTIVITY_EVENT)).toBe(false);

    successData(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(sender, {}));
    dispose();
    recordMcpLifecycle(harness);

    expect(sender.activityEvents()).toHaveLength(0);
    expect(handlers.has(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.ACTIVITY_SNAPSHOT)).toBe(false);
    expect(handlers.has(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE)).toBe(false);
  });

  it('validates cursors before subscribing and snapshots from the validated cut', () => {
    const harness = createHarness();
    recordMcpLifecycle(harness);
    const cursor = harness.ledger.snapshot().cursor;
    const sender = new WebContentsMock(2);
    const order: string[] = [];
    const originalValidateCursor = harness.ledger.validateCursor.bind(harness.ledger);
    const originalSubscribe = harness.ledger.subscribe.bind(harness.ledger);
    const originalSnapshotFromValidatedCursor = harness.ledger.snapshotFromValidatedCursor.bind(
      harness.ledger,
    );
    const validate = vi.spyOn(harness.ledger, 'validateCursor');
    const subscribe = vi.spyOn(harness.ledger, 'subscribe');
    const snapshotFromValidatedCursor = vi.spyOn(harness.ledger, 'snapshotFromValidatedCursor');
    validate.mockImplementation((cursor) => {
      order.push('validate');
      return originalValidateCursor(cursor);
    });
    subscribe.mockImplementation((listener) => {
      order.push('subscribe');
      return originalSubscribe(listener);
    });
    snapshotFromValidatedCursor.mockImplementation((cursor) => {
      order.push('snapshot');
      return originalSnapshotFromValidatedCursor(cursor);
    });

    registerActivityIpc(harness.ledger);
    const result = successData<{ readonly cursor: ActivityCursor }>(
      activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(sender, {
        cursor,
      }),
    );

    expect(order).toEqual(['validate', 'subscribe', 'snapshot']);
    expect(result.cursor.runtimeId).toBe(cursor.runtimeId);
    expect(sender.listenerCount('destroyed')).toBe(1);
  });

  it('rejects malformed requests and future cursors without changing subscription state', () => {
    const harness = createHarness();
    const sender = new WebContentsMock(3);
    const subscribe = vi.spyOn(harness.ledger, 'subscribe');
    registerActivityIpc(harness.ledger);

    const malformed = activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(sender, {
      cursor: { runtimeId: 'runtime_1', sequence: -1 },
    }) as ActivityFailure;
    const future = activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(sender, {
      cursor: { ...harness.ledger.snapshot().cursor, sequence: 999 },
    }) as ActivityFailure;

    expect(malformed).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity request' },
    });
    expect(future).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity cursor' },
    });
    expect(subscribe).not.toHaveBeenCalled();
    expect(sender.listenerCount('destroyed')).toBe(0);
  });

  it('serves read-only snapshots without subscribing', () => {
    const harness = createHarness();
    const sender = new WebContentsMock(4);
    const subscribe = vi.spyOn(harness.ledger, 'subscribe');
    registerActivityIpc(harness.ledger);

    const snapshot = successData<{ readonly events: readonly ActivityEventView[] }>(
      activityHandler(IPC_CHANNELS.ACTIVITY_SNAPSHOT)(sender, {}),
    );
    recordMcpLifecycle(harness);

    expect(snapshot.events).toEqual([]);
    expect(subscribe).not.toHaveBeenCalled();
    expect(sender.activityEvents()).toEqual([]);
    expect(sender.listenerCount('destroyed')).toBe(0);
  });

  it('keeps repeat subscribe, malformed unsubscribe, explicit unsubscribe, and windows isolated', () => {
    const harness = createHarness();
    const senderA = new WebContentsMock(10);
    const senderB = new WebContentsMock(11);
    registerActivityIpc(harness.ledger);

    successData(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(senderA, {}));
    successData(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(senderB, {}));
    recordMcpLifecycle(harness);
    const firstA = senderA.activityEvents().length;
    const firstB = senderB.activityEvents().length;

    successData(
      activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(senderA, {
        cursor: harness.ledger.snapshot().cursor,
      }),
    );
    expect(senderA.listenerCount('destroyed')).toBe(1);
    recordMcpLifecycle(harness);
    expect(senderA.activityEvents().length).toBeGreaterThan(firstA);
    expect(senderB.activityEvents().length).toBeGreaterThan(firstB);
    expect(senderA.activityEvents().length - firstA).toBe(senderB.activityEvents().length - firstB);

    const malformed = activityHandler(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE)(senderA, {
      unexpected: true,
    }) as ActivityFailure;
    expect(malformed).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity request' },
    });
    const beforeStillSubscribed = senderA.activityEvents().length;
    recordMcpLifecycle(harness);
    expect(senderA.activityEvents().length).toBeGreaterThan(beforeStillSubscribed);

    expect(activityHandler(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE)(senderA, {})).toMatchObject({
      success: true,
      data: { unsubscribed: true },
    });
    expect(activityHandler(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE)(senderA, {})).toMatchObject({
      success: true,
      data: { unsubscribed: true },
    });
    const afterUnsubscribeA = senderA.activityEvents().length;
    const beforeNextB = senderB.activityEvents().length;
    recordMcpLifecycle(harness);
    expect(senderA.activityEvents()).toHaveLength(afterUnsubscribeA);
    expect(senderB.activityEvents().length).toBeGreaterThan(beforeNextB);
  });

  it('rejects null subscribe and snapshot payloads without registering a subscriber', () => {
    const harness = createHarness();
    const sender = new WebContentsMock(18);
    registerActivityIpc(harness.ledger);

    expect(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(sender, null)).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity request' },
    });
    expect(activityHandler(IPC_CHANNELS.ACTIVITY_SNAPSHOT)(sender, null)).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity request' },
    });
    recordMcpLifecycle(harness);
    expect(sender.activityEvents()).toHaveLength(0);
    expect(sender.listenerCount('destroyed')).toBe(0);
  });

  it('rejects null unsubscribe payloads without mutating an existing subscription', () => {
    const harness = createHarness();
    const sender = new WebContentsMock(19);
    registerActivityIpc(harness.ledger);

    successData(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(sender, {}));
    recordMcpLifecycle(harness);
    const beforeMalformedUnsubscribe = sender.activityEvents().length;

    expect(activityHandler(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE)(sender, null)).toMatchObject({
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity request' },
    });
    recordMcpLifecycle(harness);
    expect(sender.activityEvents().length).toBeGreaterThan(beforeMalformedUnsubscribe);
    expect(sender.listenerCount('destroyed')).toBe(1);
  });

  it('cleans destroyed and send-race subscribers without retrying them', () => {
    const harness = createHarness();
    const destroyed = new WebContentsMock(20);
    const throwing = new WebContentsMock(21);
    const healthy = new WebContentsMock(22);
    registerActivityIpc(harness.ledger);

    successData(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(destroyed, {}));
    successData(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(throwing, {}));
    successData(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(healthy, {}));
    destroyed.destroy();
    throwing.throwOnSend = true;

    recordMcpLifecycle(harness);
    const throwingAttemptsAfterRemoval = throwing.send.mock.calls.length;
    const healthyAfterFirst = healthy.activityEvents().length;
    recordMcpLifecycle(harness);

    expect(destroyed.activityEvents()).toHaveLength(0);
    expect(throwing.send).toHaveBeenCalledTimes(throwingAttemptsAfterRemoval);
    expect(healthy.activityEvents().length).toBeGreaterThan(healthyAfterFirst);
  });

  it('hydrates renderer reloads from the same ledger cursor without gaps', () => {
    const harness = createHarness();
    const senderA = new WebContentsMock(30);
    const senderB = new WebContentsMock(31);
    registerActivityIpc(harness.ledger);

    successData(activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(senderA, {}));
    recordMcpLifecycle(harness, 'get_app_status');
    const cursorC = harness.ledger.snapshot().cursor;
    senderA.destroy();
    const retainedAfterC = recordMcpLifecycle(harness, 'get_app_status');

    const hydrated = successData<{
      readonly cursor: ActivityCursor;
      readonly events: readonly ActivityEventView[];
    }>(
      activityHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE)(senderB, {
        cursor: cursorC,
      }),
    );
    const pushedAfterHydration = recordMcpLifecycle(harness, 'get_app_status');

    expect(hydrated.cursor.runtimeId).toBe(cursorC.runtimeId);
    expect(hydrated.events.map((event) => event.sequence)).toEqual(
      retainedAfterC.map((event) => event.sequence),
    );
    expect(senderB.activityEvents().map((event) => event.sequence)).toEqual(
      pushedAfterHydration.map((event) => event.sequence),
    );
  });
});
