import { describe, expect, it } from 'vitest';
import { ActivityHealthSchema } from '@/shared/activity-contract.js';
import {
  ActivityHealthMonitor,
  type ActivityHealthCode,
  type ActivityHealthStage,
} from '@linkterm/runtime/core/activity/activity-health';

const FIRST_TIMESTAMP = '2026-07-12T01:02:03.000Z';
const SECOND_TIMESTAMP = '2026-07-12T01:02:04.000Z';

function createClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? FIRST_TIMESTAMP;
}

function zeroHealth() {
  return {
    captureFailureCount: 0,
    droppedEventCount: 0,
    evictedEventCount: 0,
    listenerFailureCount: 0,
    policyFailureCount: 0,
    incompleteLifecycleCount: 0,
  };
}

describe('ActivityHealthMonitor', () => {
  it('starts with a strict immutable zero snapshot', () => {
    const monitor = new ActivityHealthMonitor(() => FIRST_TIMESTAMP);

    const snapshot = monitor.snapshot();

    expect(snapshot).toEqual(zeroHealth());
    expect(ActivityHealthSchema.parse(snapshot)).toEqual(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('records bounded capture, eviction, listener, and policy health independently', () => {
    const monitor = new ActivityHealthMonitor(
      createClock(FIRST_TIMESTAMP, SECOND_TIMESTAMP, FIRST_TIMESTAMP),
    );

    monitor.recordCaptureFailure('capacity', 'capacity-exceeded', 2);
    monitor.recordEviction(3);
    monitor.recordListenerFailure();
    monitor.recordPolicyFailure();

    expect(monitor.snapshot()).toEqual({
      captureFailureCount: 1,
      droppedEventCount: 2,
      evictedEventCount: 3,
      listenerFailureCount: 1,
      policyFailureCount: 1,
      incompleteLifecycleCount: 0,
      lastFailure: {
        stage: 'policy',
        code: 'policy-drift',
        timestamp: FIRST_TIMESTAMP,
      },
    });
  });

  it('saturates externally weighted safe counters without wrapping', () => {
    const monitor = new ActivityHealthMonitor(() => FIRST_TIMESTAMP);

    monitor.recordCaptureFailure('capacity', 'capacity-exceeded', Number.MAX_SAFE_INTEGER);
    monitor.recordCaptureFailure('capacity', 'capacity-exceeded', 1);
    monitor.recordEviction(Number.MAX_SAFE_INTEGER);
    monitor.recordEviction(1);

    expect(monitor.snapshot()).toMatchObject({
      captureFailureCount: 2,
      droppedEventCount: Number.MAX_SAFE_INTEGER,
      evictedEventCount: Number.MAX_SAFE_INTEGER,
    });
  });

  it('ignores invalid counter weights while still recording one safe capture failure', () => {
    const monitor = new ActivityHealthMonitor(() => FIRST_TIMESTAMP);

    for (const dropped of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      monitor.recordCaptureFailure('schema', 'invalid-event', dropped);
      monitor.recordEviction(dropped);
    }

    expect(monitor.snapshot()).toMatchObject({
      captureFailureCount: 4,
      droppedEventCount: 0,
      evictedEventCount: 0,
    });
  });

  it('keeps last failure stage, code, and timestamp inside closed safe contracts', () => {
    const monitor = new ActivityHealthMonitor(() => 'unsafe timestamp with payload');

    monitor.recordCaptureFailure(
      'arbitrary-stage' as ActivityHealthStage,
      'arbitrary code with payload' as ActivityHealthCode,
      1,
    );

    const snapshot = monitor.snapshot();
    expect(snapshot.lastFailure).toEqual({
      stage: 'schema',
      code: 'invalid-event',
      timestamp: '1970-01-01T00:00:00.000Z',
    });
    expect(ActivityHealthSchema.safeParse(snapshot).success).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('arbitrary');
    expect(JSON.stringify(snapshot)).not.toContain('payload');
  });

  it('contains a throwing clock and substitutes a safe timestamp', () => {
    const monitor = new ActivityHealthMonitor(() => {
      throw new Error('clock payload');
    });

    expect(() => monitor.recordListenerFailure()).not.toThrow();
    expect(monitor.snapshot().lastFailure).toEqual({
      stage: 'listener',
      code: 'listener-threw',
      timestamp: '1970-01-01T00:00:00.000Z',
    });
  });

  it('bounds a syntactically valid timestamp before retaining it', () => {
    const oversizedTimestamp = `2026-07-12T00:00:00.${'0'.repeat(1_000)}Z`;
    const monitor = new ActivityHealthMonitor(() => oversizedTimestamp);

    monitor.recordPolicyFailure();

    expect(monitor.snapshot().lastFailure?.timestamp).toBe('1970-01-01T00:00:00.000Z');
    expect(JSON.stringify(monitor.snapshot())).not.toContain('0'.repeat(100));
  });

  it('tracks lifecycle entries until each completion closure makes its first decision', () => {
    const monitor = new ActivityHealthMonitor(() => FIRST_TIMESTAMP);
    const finishFirst = monitor.enterLifecycle();
    const finishSecond = monitor.enterLifecycle();

    expect(monitor.snapshot().incompleteLifecycleCount).toBe(2);

    finishFirst();
    finishFirst();
    expect(monitor.snapshot().incompleteLifecycleCount).toBe(1);

    finishSecond();
    finishSecond();
    expect(monitor.snapshot().incompleteLifecycleCount).toBe(0);
  });

  it('resets every counter and gauge for a new runtime generation', () => {
    const monitor = new ActivityHealthMonitor(() => FIRST_TIMESTAMP);
    monitor.enterLifecycle();
    monitor.recordCaptureFailure('schema', 'invalid-event', 2);
    monitor.recordEviction(1);
    monitor.recordListenerFailure();
    monitor.recordPolicyFailure();

    monitor.resetForRuntime();

    expect(monitor.snapshot()).toEqual(zeroHealth());
  });

  it('makes completion closures from an older generation idempotent no-ops', () => {
    const monitor = new ActivityHealthMonitor(() => FIRST_TIMESTAMP);
    const staleFinish = monitor.enterLifecycle();
    monitor.resetForRuntime();
    const currentFinish = monitor.enterLifecycle();

    staleFinish();
    staleFinish();
    expect(monitor.snapshot().incompleteLifecycleCount).toBe(1);

    currentFinish();
    currentFinish();
    expect(monitor.snapshot().incompleteLifecycleCount).toBe(0);
  });
});
