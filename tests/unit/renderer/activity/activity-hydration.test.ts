import { describe, expect, it, vi } from 'vitest';
import type { ActivityEventView, ActivitySnapshotView } from '@/shared/activity-contract.js';
import type { PreloadResult } from '@/shared/preload-api.js';
import {
  createActivityHydrationController,
  type ActivityBridge,
} from '@/renderer/features/activity/activity-hydration.js';
import { selectActivityItems } from '@/renderer/features/activity/activity-reducer.js';
import { activitySnapshot, operationEvent } from './activity-fixtures.js';

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

function success(data: ActivitySnapshotView): PreloadResult<ActivitySnapshotView> {
  return { success: true, data };
}

function invalidCursorFailure(): PreloadResult<ActivitySnapshotView> {
  return {
    success: false,
    error: {
      code: 'INVALID_CURSOR',
      message: 'Invalid activity cursor',
    },
  };
}

function createBridge(): {
  readonly bridge: ActivityBridge;
  readonly calls: string[];
  readonly deferredSubscribe: Deferred<PreloadResult<ActivitySnapshotView>>;
  emit(event: ActivityEventView): void;
} {
  const calls: string[] = [];
  const deferredSubscribe = new Deferred<PreloadResult<ActivitySnapshotView>>();
  let handler: ((event: ActivityEventView) => void) | undefined;
  const bridge: ActivityBridge = {
    onEvent: (next) => {
      calls.push('onEvent');
      handler = next;
      return () => {
        calls.push('offEvent');
        handler = undefined;
      };
    },
    subscribe: vi.fn(() => {
      calls.push('subscribe');
      return deferredSubscribe.promise;
    }),
    snapshot: vi.fn(async () => success(activitySnapshot([]))),
    unsubscribe: vi.fn(async () => ({ success: true, data: { unsubscribed: true } })),
  };
  return {
    bridge,
    calls,
    deferredSubscribe,
    emit: (event) => {
      if (handler === undefined) throw new Error('No event handler registered');
      handler(event);
    },
  };
}

describe('activity hydration controller', () => {
  it('registers the event listener before subscribe and applies buffered events after the snapshot cut', async () => {
    const fixture = createBridge();
    const controller = createActivityHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.emit(
      operationEvent({
        sequence: 2,
        operationId: 'operation_after_cut',
        phase: 'running',
        action: 'open_session',
        risk: 'state-affecting',
      }),
    );
    fixture.deferredSubscribe.resolve(
      success(
        activitySnapshot([
          operationEvent({
            sequence: 1,
            operationId: 'operation_snapshot',
            phase: 'succeeded',
            action: 'get_app_status',
            risk: 'read-only',
          }),
        ]),
      ),
    );
    await ready;

    expect(fixture.calls.slice(0, 2)).toEqual(['onEvent', 'subscribe']);
    expect(selectActivityItems(controller.getState(), {}).map((item) => item.operationId)).toEqual([
      'operation_after_cut',
      'operation_snapshot',
    ]);
  });

  it('discards buffered events at or below the returned snapshot cursor', async () => {
    const fixture = createBridge();
    const controller = createActivityHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.emit(
      operationEvent({
        sequence: 1,
        operationId: 'operation_duplicate_buffer',
        phase: 'running',
        action: 'get_app_status',
        risk: 'read-only',
      }),
    );
    fixture.deferredSubscribe.resolve(
      success(
        activitySnapshot([
          operationEvent({
            sequence: 1,
            operationId: 'operation_snapshot',
            phase: 'succeeded',
            action: 'get_app_status',
            risk: 'read-only',
          }),
        ]),
      ),
    );
    await ready;

    expect(selectActivityItems(controller.getState(), {}).map((item) => item.operationId)).toEqual([
      'operation_snapshot',
    ]);
  });

  it('resnapshots on a pushed sequence gap and keeps the out-of-order event out of state', async () => {
    const fixture = createBridge();
    const gapSnapshot = activitySnapshot([
      operationEvent({
        sequence: 1,
        operationId: 'operation_snapshot',
        phase: 'succeeded',
        action: 'get_app_status',
        risk: 'read-only',
      }),
    ]);
    vi.mocked(fixture.bridge.snapshot).mockResolvedValueOnce(success(gapSnapshot));
    const controller = createActivityHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(success(gapSnapshot));
    await ready;
    fixture.emit(
      operationEvent({
        sequence: 3,
        operationId: 'operation_gap',
        phase: 'succeeded',
        action: 'get_app_status',
        risk: 'read-only',
      }),
    );
    await Promise.resolve();

    expect(fixture.bridge.snapshot).toHaveBeenCalledOnce();
    expect(selectActivityItems(controller.getState(), {}).map((item) => item.operationId)).toEqual([
      'operation_snapshot',
    ]);
    expect(controller.getState().diagnostics.some((item) => item.code === 'sequence-gap')).toBe(
      true,
    );
  });

  it('does not apply buffered events when the subscribe result is malformed', async () => {
    const fixture = createBridge();
    const controller = createActivityHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.emit(
      operationEvent({
        sequence: 1,
        operationId: 'operation_buffered_after_bad_subscribe',
        phase: 'running',
        action: 'open_session',
        risk: 'state-affecting',
      }),
    );
    fixture.deferredSubscribe.resolve({
      success: true,
      data: { rawEvidence: 'not-display-safe' },
    } as unknown as PreloadResult<ActivitySnapshotView>);
    await ready;

    expect(selectActivityItems(controller.getState(), {})).toHaveLength(0);
    expect(controller.getState().diagnostics.some((item) => item.code === 'invalid-snapshot')).toBe(
      true,
    );
  });

  it('turns subscribe rejection into a safe local diagnostic without retaining raw errors', async () => {
    const fixture = createBridge();
    vi.mocked(fixture.bridge.subscribe).mockRejectedValueOnce(
      new Error('secret stack from ipcRenderer'),
    );
    const controller = createActivityHydrationController(fixture.bridge);

    await expect(controller.start()).resolves.toBeUndefined();

    expect(controller.getState().diagnostics.at(-1)).toMatchObject({
      code: 'subscribe-failed',
    });
    expect(JSON.stringify(controller.getState())).not.toContain('secret stack');
    expect(JSON.stringify(controller.getState())).not.toContain('ipcRenderer');
  });

  it('retries a fresh subscription once when a stored cursor is rejected', async () => {
    const fixture = createBridge();
    vi.mocked(fixture.bridge.subscribe)
      .mockResolvedValueOnce(invalidCursorFailure())
      .mockResolvedValueOnce(
        success(
          activitySnapshot([
            operationEvent({
              sequence: 1,
              operationId: 'operation_fresh_after_cursor_reject',
              phase: 'running',
              action: 'open_session',
              risk: 'state-affecting',
            }),
          ]),
        ),
      );
    const controller = createActivityHydrationController(fixture.bridge);

    await controller.start({ cursor: { runtimeId: 'runtime_old', sequence: 99 } });

    expect(fixture.bridge.subscribe).toHaveBeenNthCalledWith(1, {
      cursor: { runtimeId: 'runtime_old', sequence: 99 },
    });
    expect(fixture.bridge.subscribe).toHaveBeenNthCalledWith(2, {});
    expect(selectActivityItems(controller.getState(), {}).map((item) => item.operationId)).toEqual([
      'operation_fresh_after_cursor_reject',
    ]);
    expect(controller.getState().diagnostics).toHaveLength(0);
  });

  it('ignores a pending gap resnapshot after stop', async () => {
    const fixture = createBridge();
    const deferredSnapshot = new Deferred<PreloadResult<ActivitySnapshotView>>();
    vi.mocked(fixture.bridge.snapshot).mockReturnValueOnce(deferredSnapshot.promise);
    const controller = createActivityHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(
      success(
        activitySnapshot([
          operationEvent({
            sequence: 1,
            operationId: 'operation_before_stop',
            phase: 'succeeded',
            action: 'get_app_status',
            risk: 'read-only',
          }),
        ]),
      ),
    );
    await ready;
    fixture.emit(
      operationEvent({
        sequence: 3,
        operationId: 'operation_gap_after_stop',
        phase: 'succeeded',
        action: 'get_app_status',
        risk: 'read-only',
      }),
    );
    await controller.stop();
    deferredSnapshot.resolve(
      success(
        activitySnapshot([
          operationEvent({
            sequence: 2,
            operationId: 'operation_resnapshot_after_stop',
            phase: 'succeeded',
            action: 'get_app_status',
            risk: 'read-only',
          }),
        ]),
      ),
    );
    await Promise.resolve();

    expect(selectActivityItems(controller.getState(), {}).map((item) => item.operationId)).toEqual([
      'operation_before_stop',
    ]);
  });

  it('does not let an older gap resnapshot overwrite a newer cursor', async () => {
    const fixture = createBridge();
    vi.mocked(fixture.bridge.snapshot).mockResolvedValueOnce(
      success(
        activitySnapshot(
          [
            operationEvent({
              sequence: 4,
              operationId: 'operation_old_snapshot',
              phase: 'succeeded',
              action: 'get_app_status',
              risk: 'read-only',
            }),
          ],
          { sequence: 4 },
        ),
      ),
    );
    const controller = createActivityHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(
      success(
        activitySnapshot([
          operationEvent({
            sequence: 5,
            operationId: 'operation_snapshot',
            phase: 'succeeded',
            action: 'get_app_status',
            risk: 'read-only',
          }),
        ]),
      ),
    );
    await ready;
    fixture.emit(
      operationEvent({
        sequence: 6,
        operationId: 'operation_live_newer',
        phase: 'running',
        action: 'open_session',
        risk: 'state-affecting',
      }),
    );
    fixture.emit(
      operationEvent({
        sequence: 8,
        operationId: 'operation_gap',
        phase: 'running',
        action: 'open_session',
        risk: 'state-affecting',
      }),
    );
    await Promise.resolve();

    expect(controller.getState().cursor).toEqual({ runtimeId: 'runtime_1', sequence: 6 });
    expect(selectActivityItems(controller.getState(), {}).map((item) => item.operationId)).toEqual([
      'operation_live_newer',
      'operation_snapshot',
    ]);
  });

  it('cleans both local listener and Main subscription on stop', async () => {
    const fixture = createBridge();
    const controller = createActivityHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(success(activitySnapshot([])));
    await ready;
    await controller.stop();

    expect(fixture.calls).toContain('offEvent');
    expect(fixture.bridge.unsubscribe).toHaveBeenCalledOnce();
  });
});
