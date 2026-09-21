import { z } from 'zod';
import {
  ActivityFailureStageSchema,
  ActivityHealthSchema,
  type ActivityFailureStage,
  type ActivityHealth,
} from '@linkterm/contracts/activity-contract';

export type ActivityHealthStage = ActivityFailureStage;

export type ActivityHealthCode =
  | 'capture-failed'
  | 'policy-drift'
  | 'invalid-event'
  | 'capacity-exceeded'
  | 'delivery-failed'
  | 'listener-threw'
  | 'reentrant-append'
  | 'invalid-cursor';

const ActivityHealthCodeSchema = z.enum([
  'capture-failed',
  'policy-drift',
  'invalid-event',
  'capacity-exceeded',
  'delivery-failed',
  'listener-threw',
  'reentrant-append',
  'invalid-cursor',
]);
const TimestampSchema = z.string().datetime({ offset: true });
const SAFE_FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const MAX_SAFE_TIMESTAMP_LENGTH = 64;

interface LastFailure {
  readonly stage: ActivityHealthStage;
  readonly code: ActivityHealthCode;
  readonly timestamp: string;
}

function incrementSafe(current: number, amount = 1): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return current;
  }
  if (current >= Number.MAX_SAFE_INTEGER - amount) {
    return Number.MAX_SAFE_INTEGER;
  }
  return current + amount;
}

export class ActivityHealthMonitor {
  private captureFailureCount = 0;
  private droppedEventCount = 0;
  private evictedEventCount = 0;
  private listenerFailureCount = 0;
  private policyFailureCount = 0;
  private incompleteLifecycleCount = 0;
  private lastFailure: LastFailure | undefined;
  private generation: object = {};

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  enterLifecycle(): () => void {
    const enteredGeneration = this.generation;
    let completed = false;
    this.incompleteLifecycleCount = incrementSafe(this.incompleteLifecycleCount);

    return () => {
      if (completed) {
        return;
      }
      completed = true;
      if (enteredGeneration !== this.generation) {
        return;
      }
      this.incompleteLifecycleCount = Math.max(0, this.incompleteLifecycleCount - 1);
    };
  }

  recordCaptureFailure(
    stage: ActivityHealthStage,
    code: ActivityHealthCode,
    dropped: number,
  ): void {
    this.captureFailureCount = incrementSafe(this.captureFailureCount);
    this.droppedEventCount = incrementSafe(this.droppedEventCount, dropped);
    this.recordLastFailure(stage, code);
  }

  recordEviction(count: number): void {
    this.evictedEventCount = incrementSafe(this.evictedEventCount, count);
  }

  recordListenerFailure(): void {
    this.listenerFailureCount = incrementSafe(this.listenerFailureCount);
    this.recordLastFailure('listener', 'listener-threw');
  }

  recordPolicyFailure(): void {
    this.policyFailureCount = incrementSafe(this.policyFailureCount);
    this.recordLastFailure('policy', 'policy-drift');
  }

  resetForRuntime(): void {
    this.generation = {};
    this.captureFailureCount = 0;
    this.droppedEventCount = 0;
    this.evictedEventCount = 0;
    this.listenerFailureCount = 0;
    this.policyFailureCount = 0;
    this.incompleteLifecycleCount = 0;
    this.lastFailure = undefined;
  }

  snapshot(): ActivityHealth {
    return ActivityHealthSchema.parse({
      captureFailureCount: this.captureFailureCount,
      droppedEventCount: this.droppedEventCount,
      evictedEventCount: this.evictedEventCount,
      listenerFailureCount: this.listenerFailureCount,
      policyFailureCount: this.policyFailureCount,
      incompleteLifecycleCount: this.incompleteLifecycleCount,
      ...(this.lastFailure === undefined ? {} : { lastFailure: this.lastFailure }),
    });
  }

  private recordLastFailure(stage: ActivityHealthStage, code: ActivityHealthCode): void {
    const parsedStage = ActivityFailureStageSchema.safeParse(stage);
    const parsedCode = ActivityHealthCodeSchema.safeParse(code);
    this.lastFailure = {
      stage: parsedStage.success ? parsedStage.data : 'schema',
      code: parsedCode.success ? parsedCode.data : 'invalid-event',
      timestamp: this.safeTimestamp(),
    };
  }

  private safeTimestamp(): string {
    try {
      const timestamp = this.now();
      return timestamp.length <= MAX_SAFE_TIMESTAMP_LENGTH &&
        TimestampSchema.safeParse(timestamp).success
        ? timestamp
        : SAFE_FALLBACK_TIMESTAMP;
    } catch {
      return SAFE_FALLBACK_TIMESTAMP;
    }
  }
}
