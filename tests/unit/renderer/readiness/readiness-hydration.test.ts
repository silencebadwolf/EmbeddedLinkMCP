import { describe, expect, it, vi } from 'vitest';
import {
  READINESS_SCHEMA_VERSION,
  RuntimeReadinessSnapshotSchema,
  type ReadinessEvent,
  type RuntimeReadinessSnapshot,
} from '@/shared/readiness-contract.js';
import type { PreloadResult } from '@/shared/preload-api.js';
import {
  createRuntimeReadinessHydrationController,
  type RuntimeReadinessBridge,
} from '@/renderer/features/readiness/readiness-hydration.js';

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

function snapshot(
  generation: number,
  status: RuntimeReadinessSnapshot['status'] = 'ready',
  diagnostics: RuntimeReadinessSnapshot['diagnostics'] = [],
): RuntimeReadinessSnapshot {
  const checkedAt = `2026-07-13T04:00:${String(generation).padStart(2, '0')}.000Z`;
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
        severity: status === 'ready' ? 'info' : 'warning',
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
    diagnostics,
  });
}

function success(data: RuntimeReadinessSnapshot): PreloadResult<RuntimeReadinessSnapshot> {
  return { success: true, data };
}

function invalidCursorFailure(): PreloadResult<RuntimeReadinessSnapshot> {
  return {
    success: false,
    error: {
      code: 'INVALID_READINESS_CURSOR',
      message: 'Invalid readiness cursor',
    },
  };
}

function createBridge(): {
  readonly bridge: RuntimeReadinessBridge;
  readonly calls: string[];
  readonly deferredSubscribe: Deferred<PreloadResult<RuntimeReadinessSnapshot>>;
  emit(snapshot: RuntimeReadinessSnapshot): void;
  emitInvalid(): void;
} {
  const calls: string[] = [];
  const deferredSubscribe = new Deferred<PreloadResult<RuntimeReadinessSnapshot>>();
  let handler: ((event: ReadinessEvent) => void) | undefined;
  let invalidHandler: (() => void) | undefined;
  const bridge: RuntimeReadinessBridge = {
    onEvent: (next, onInvalidPayload) => {
      calls.push('onEvent');
      handler = next;
      invalidHandler = onInvalidPayload;
      return () => {
        calls.push('offEvent');
        handler = undefined;
        invalidHandler = undefined;
      };
    },
    subscribe: vi.fn(() => {
      calls.push('subscribe');
      return deferredSubscribe.promise;
    }),
    get: vi.fn(async () => success(snapshot(0))),
    refresh: vi.fn(async () => success(snapshot(1))),
    unsubscribe: vi.fn(async () => ({ success: true, data: { unsubscribed: true } })),
  };
  return {
    bridge,
    calls,
    deferredSubscribe,
    emit: (nextSnapshot) => {
      if (handler === undefined) throw new Error('No readiness handler registered');
      handler({ schemaVersion: READINESS_SCHEMA_VERSION, snapshot: nextSnapshot });
    },
    emitInvalid: () => {
      if (invalidHandler === undefined) throw new Error('No invalid readiness handler registered');
      invalidHandler();
    },
  };
}

describe('runtime readiness hydration controller', () => {
  it('starts in loading, subscribes before snapshot, and applies buffered newer events', async () => {
    const fixture = createBridge();
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    const ready = controller.start();
    expect(controller.getState().phase).toBe('loading');
    expect(controller.getState().snapshot).toBeUndefined();
    fixture.emit(snapshot(2, 'action-required'));
    fixture.deferredSubscribe.resolve(success(snapshot(1)));
    await ready;

    expect(fixture.calls.slice(0, 2)).toEqual(['onEvent', 'subscribe']);
    expect(controller.getState().snapshot?.generation).toBe(2);
    expect(controller.getState().phase).toBe('ready');
  });

  it('discards stale pushed events at or below the current generation', async () => {
    const fixture = createBridge();
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(success(snapshot(3)));
    await ready;
    fixture.emit(snapshot(2, 'action-required'));

    expect(controller.getState().snapshot?.generation).toBe(3);
  });

  it('keeps the latest refresh generation when overlapping refreshes resolve out of order', async () => {
    const fixture = createBridge();
    const slow = new Deferred<PreloadResult<RuntimeReadinessSnapshot>>();
    const fast = new Deferred<PreloadResult<RuntimeReadinessSnapshot>>();
    vi.mocked(fixture.bridge.refresh)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(success(snapshot(1)));
    await ready;
    const first = controller.refresh();
    const second = controller.refresh();
    fast.resolve(success(snapshot(3)));
    await second;
    slow.resolve(success(snapshot(2)));
    await first;

    expect(controller.getState().snapshot?.generation).toBe(3);
  });

  it('retries with get() after refresh failure and records only safe diagnostics', async () => {
    const fixture = createBridge();
    vi.mocked(fixture.bridge.refresh).mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_READINESS_PAYLOAD', message: 'Invalid readiness payload' },
    });
    vi.mocked(fixture.bridge.get).mockResolvedValueOnce(success(snapshot(5)));
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(success(snapshot(1)));
    await ready;
    await controller.refresh();

    expect(fixture.bridge.get).toHaveBeenCalledOnce();
    expect(controller.getState().snapshot?.generation).toBe(5);
    expect(controller.getState().diagnostics).toContainEqual(
      expect.objectContaining({ code: 'readiness.refresh_recovered', severity: 'warning' }),
    );
    expect(JSON.stringify(controller.getState())).not.toContain('INVALID_READINESS_PAYLOAD');
  });

  it('keeps provider diagnostics from partial snapshots available for display', async () => {
    const fixture = createBridge();
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);
    const partial = snapshot(1, 'action-required', [
      {
        code: 'readiness.serial.discovery_failed',
        severity: 'error',
        checkedAt: '2026-07-13T04:00:01.000Z',
      },
    ]);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(success(partial));
    await ready;

    expect(controller.getState().snapshot?.diagnostics).toEqual(partial.diagnostics);
    expect(controller.getState().phase).toBe('ready');
  });

  it('retries fresh subscription once when a stored cursor is rejected', async () => {
    const fixture = createBridge();
    vi.mocked(fixture.bridge.subscribe)
      .mockResolvedValueOnce(invalidCursorFailure())
      .mockResolvedValueOnce(success(snapshot(1)));
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    await controller.start({ cursor: { snapshotId: 'readiness_old', generation: 99 } });

    expect(fixture.bridge.subscribe).toHaveBeenNthCalledWith(1, {
      cursor: { snapshotId: 'readiness_old', generation: 99 },
    });
    expect(fixture.bridge.subscribe).toHaveBeenNthCalledWith(2, {});
    expect(controller.getState().snapshot?.generation).toBe(1);
  });

  it('turns malformed subscribe responses into local safe diagnostics', async () => {
    const fixture = createBridge();
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve({
      success: true,
      data: { rawStack: 'C:/Users/Admin/private/token' },
    } as unknown as PreloadResult<RuntimeReadinessSnapshot>);
    await ready;

    expect(controller.getState().diagnostics).toContainEqual(
      expect.objectContaining({ code: 'readiness.invalid_payload', severity: 'error' }),
    );
    expect(JSON.stringify(controller.getState())).not.toContain('private/token');
  });

  it('turns malformed pushed readiness events into bounded local diagnostics', async () => {
    const fixture = createBridge();
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(success(snapshot(1)));
    await ready;
    fixture.emitInvalid();

    expect(controller.getState().diagnostics).toContainEqual(
      expect.objectContaining({ code: 'readiness.invalid_payload', severity: 'error' }),
    );
    expect(JSON.stringify(controller.getState())).not.toMatch(/raw|stack|secret|private/i);
  });

  it('cleans the local event listener after malformed subscribe responses so start can retry', async () => {
    const fixture = createBridge();
    vi.mocked(fixture.bridge.subscribe)
      .mockResolvedValueOnce({
        success: true,
        data: { rawStack: 'C:/Users/Admin/private/token' },
      } as unknown as PreloadResult<RuntimeReadinessSnapshot>)
      .mockResolvedValueOnce(success(snapshot(2)));
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    await controller.start();

    expect(fixture.calls).toContain('offEvent');
    await controller.start();

    expect(fixture.bridge.subscribe).toHaveBeenCalledTimes(2);
    expect(controller.getState().snapshot?.generation).toBe(2);
    expect(JSON.stringify(controller.getState())).not.toContain('private/token');
  });

  it('cleans both the local listener and Main subscription on stop', async () => {
    const fixture = createBridge();
    const controller = createRuntimeReadinessHydrationController(fixture.bridge);

    const ready = controller.start();
    fixture.deferredSubscribe.resolve(success(snapshot(1)));
    await ready;
    await controller.stop();

    expect(fixture.calls).toContain('offEvent');
    expect(fixture.bridge.unsubscribe).toHaveBeenCalledOnce();
  });
});
