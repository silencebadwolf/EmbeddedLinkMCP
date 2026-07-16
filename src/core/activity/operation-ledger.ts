import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  ACTIVITY_MAX_SNAPSHOT_CALLS,
  ACTIVITY_MAX_SNAPSHOT_EVENTS,
  ACTIVITY_MAX_SNAPSHOT_OPERATIONS,
  ACTIVITY_SCHEMA_VERSION,
  ActivityCursorSchema,
  ActivityEventViewSchema,
  ActivityIdSchema,
  ActivitySnapshotViewSchema,
  CallAttemptViewSchema,
  OperationViewSchema,
  type ActivityCursor,
  type ActivityEventView,
  type ActivitySnapshotView,
  type CallAttemptView,
  type OperationView,
} from '../../shared/activity-contract.js';
import {
  ActivityEventDraftSchema,
  RetainedActivityEventSchema,
  toActivityEventView,
  type ActivityEventDraft,
  type RetainedActivityEvent,
} from './activity-event.js';
import { ActivityHealthMonitor, type ActivityHealthCode } from './activity-health.js';
import {
  createEmptyReductionState,
  reduceActivityEvent,
  type ActivityReductionState,
} from './operation-state.js';

const DEFAULT_MAX_EVENTS = 5_000;
const DEFAULT_MAX_OPERATIONS = 1_000;
const DEFAULT_MAX_CALL_ATTEMPTS = 2_000;
const DEFAULT_MAX_PROJECTED_EVENT_BYTES = 16 * 1_024;
const DEFAULT_MAX_TOTAL_STATE_BYTES = 16 * 1_024 * 1_024;

export const EVENT_INDEX_OVERHEAD_BYTES = 64;
export const OPERATION_RECORD_OVERHEAD_BYTES = 256;
export const CALL_RECORD_OVERHEAD_BYTES = 192;

const OPERATION_TERMINALS = new Set([
  'succeeded',
  'failed',
  'rejected',
  'denied',
  'expired',
  'superseded',
  'cancelled',
  'interrupted',
]);
const CALL_TERMINALS = new Set(['approval-required', 'rejected', 'succeeded', 'failed']);

export interface OperationLedgerOptions {
  readonly health: ActivityHealthMonitor;
  readonly createRuntimeId?: () => string;
  readonly createEventId?: () => string;
  readonly now?: () => string;
  readonly maxEvents?: number;
  readonly maxOperations?: number;
  readonly maxCallAttempts?: number;
  readonly maxProjectedEventBytes?: number;
  readonly maxTotalStateBytes?: number;
  /** Test seam; production default is Number.MAX_SAFE_INTEGER. */
  readonly maxSequence?: number;
}

export type ValidatedActivityCursor =
  | { readonly kind: 'none' }
  | { readonly kind: 'same-runtime'; readonly sequence: number }
  | { readonly kind: 'reset-required' };

interface LedgerEntry {
  readonly event: RetainedActivityEvent;
  readonly view: ActivityEventView;
  readonly retainedBytes: number;
  readonly projectedBytes: number;
}

interface MaterializedViews {
  readonly operations: readonly OperationView[];
  readonly calls: readonly CallAttemptView[];
}

interface LedgerLimits {
  readonly maxEvents: number;
  readonly maxOperations: number;
  readonly maxCallAttempts: number;
  readonly maxProjectedEventBytes: number;
  readonly maxTotalStateBytes: number;
  readonly maxSequence: number;
}

interface CapacityPlan extends MaterializedViews {
  readonly entries: readonly LedgerEntry[];
  readonly reduction: ActivityReductionState;
  readonly evictedCount: number;
}

class ActivityCursorError extends Error {
  constructor() {
    super('Invalid activity cursor');
    this.name = 'ActivityCursorError';
  }
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function safeLimit(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}

function boundedRecordLimit(
  name: string,
  value: number | undefined,
  fallback: number,
  sharedMaximum: number,
): number {
  const resolved = safeLimit(name, value, fallback);
  if (resolved > sharedMaximum) {
    throw new RangeError(`${name} cannot exceed the shared snapshot maximum`);
  }
  return resolved;
}

function operationIsTerminal(phase: string): boolean {
  return OPERATION_TERMINALS.has(phase);
}

function callIsTerminal(phase: string): boolean {
  return CALL_TERMINALS.has(phase);
}

function materializeViews(state: ActivityReductionState): MaterializedViews {
  const operations: OperationView[] = [];
  for (const operation of state.operations.values()) {
    if (operationIsTerminal(operation.phase)) {
      continue;
    }
    const { phase, ...fields } = operation;
    operations.push(OperationViewSchema.parse({ ...fields, operationPhase: phase }));
  }

  const calls: CallAttemptView[] = [];
  for (const call of state.calls.values()) {
    if (callIsTerminal(call.phase)) {
      continue;
    }
    const { phase, ...fields } = call;
    calls.push(CallAttemptViewSchema.parse({ ...fields, callPhase: phase }));
  }
  return { operations: Object.freeze(operations), calls: Object.freeze(calls) };
}

function pruneReleasedTerminalRecords(
  state: ActivityReductionState,
  retainedEntries: readonly LedgerEntry[],
): ActivityReductionState {
  const retainedOperationIds = new Set(retainedEntries.map(({ event }) => event.operationId));
  const retainedCallIds = new Set<string>();
  for (const { event } of retainedEntries) {
    if (event.kind === 'call-transition') {
      retainedCallIds.add(event.callId);
    }
  }

  const calls = new Map(state.calls);
  for (const [callId, call] of calls) {
    if (callIsTerminal(call.phase) && !retainedCallIds.has(callId)) {
      calls.delete(callId);
    }
  }

  const referencedOperationIds = new Set([...calls.values()].map((call) => call.operationId));
  const operations = new Map(state.operations);
  for (const [operationId, operation] of operations) {
    if (
      operationIsTerminal(operation.phase) &&
      !retainedOperationIds.has(operationId) &&
      !referencedOperationIds.has(operationId)
    ) {
      operations.delete(operationId);
    }
  }

  return { operations, calls, acceptedEventIds: state.acceptedEventIds };
}

function removePrefixFromState(
  state: ActivityReductionState,
  allEntries: readonly LedgerEntry[],
  count: number,
): ActivityReductionState {
  const acceptedEventIds = new Set(state.acceptedEventIds);
  for (let index = 0; index < count; index += 1) {
    const entry = allEntries[index];
    if (entry !== undefined) {
      acceptedEventIds.delete(entry.event.eventId);
    }
  }
  return pruneReleasedTerminalRecords(
    { operations: state.operations, calls: state.calls, acceptedEventIds },
    allEntries.slice(count),
  );
}

function accountedStateBytes(
  entries: readonly LedgerEntry[],
  state: ActivityReductionState,
  views: MaterializedViews,
): number {
  let total = state.acceptedEventIds.size * EVENT_INDEX_OVERHEAD_BYTES;
  total += state.operations.size * OPERATION_RECORD_OVERHEAD_BYTES;
  total += state.calls.size * CALL_RECORD_OVERHEAD_BYTES;
  for (const entry of entries) {
    total += entry.retainedBytes + entry.projectedBytes;
  }
  for (const operation of views.operations) {
    total += byteLength(operation);
  }
  for (const call of views.calls) {
    total += byteLength(call);
  }
  return total;
}

export class OperationLedger {
  private readonly health: ActivityHealthMonitor;
  private readonly createRuntimeId: () => string;
  private readonly createEventId: () => string;
  private readonly now: () => string;
  private readonly limits: LedgerLimits;
  private readonly listeners = new Set<(event: ActivityEventView) => void>();
  private runtimeId: string;
  private sequence = 0;
  private entries: readonly LedgerEntry[] = Object.freeze([]);
  private reduction: ActivityReductionState = createEmptyReductionState();
  private operations: readonly OperationView[] = Object.freeze([]);
  private calls: readonly CallAttemptView[] = Object.freeze([]);
  private historyEvicted = false;
  private appending = false;

  constructor(options: OperationLedgerOptions) {
    this.health = options.health;
    this.createRuntimeId = options.createRuntimeId ?? (() => `runtime-${randomUUID()}`);
    this.createEventId = options.createEventId ?? (() => `event-${randomUUID()}`);
    this.now = options.now ?? (() => new Date().toISOString());

    const maxSequence = options.maxSequence ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maxSequence) || maxSequence <= 0) {
      throw new RangeError('maxSequence must be a positive safe integer');
    }
    this.limits = {
      maxEvents: boundedRecordLimit(
        'maxEvents',
        options.maxEvents,
        DEFAULT_MAX_EVENTS,
        ACTIVITY_MAX_SNAPSHOT_EVENTS,
      ),
      maxOperations: boundedRecordLimit(
        'maxOperations',
        options.maxOperations,
        DEFAULT_MAX_OPERATIONS,
        ACTIVITY_MAX_SNAPSHOT_OPERATIONS,
      ),
      maxCallAttempts: boundedRecordLimit(
        'maxCallAttempts',
        options.maxCallAttempts,
        DEFAULT_MAX_CALL_ATTEMPTS,
        ACTIVITY_MAX_SNAPSHOT_CALLS,
      ),
      maxProjectedEventBytes: safeLimit(
        'maxProjectedEventBytes',
        options.maxProjectedEventBytes,
        DEFAULT_MAX_PROJECTED_EVENT_BYTES,
      ),
      maxTotalStateBytes: safeLimit(
        'maxTotalStateBytes',
        options.maxTotalStateBytes,
        DEFAULT_MAX_TOTAL_STATE_BYTES,
      ),
      maxSequence,
    };
    this.runtimeId = this.nextRuntimeId();
  }

  appendBatch(
    drafts: readonly ActivityEventDraft[],
  ):
    | { readonly accepted: true; readonly events: readonly ActivityEventView[] }
    | { readonly accepted: false; readonly code: string } {
    const dropped = Array.isArray(drafts) ? drafts.length : 0;
    if (this.appending) {
      return this.rejectAppend('listener', 'reentrant-append', dropped, 'reentrant-append');
    }

    this.appending = true;
    try {
      return this.appendGuarded(drafts, dropped);
    } catch {
      return this.rejectAppend('provider', 'capture-failed', dropped, 'capture-failed');
    } finally {
      this.appending = false;
    }
  }

  validateCursor(cursor?: ActivityCursor): ValidatedActivityCursor {
    if (cursor === undefined) {
      return Object.freeze({ kind: 'none' });
    }

    let parsed: ActivityCursor;
    try {
      const result = ActivityCursorSchema.safeParse(cursor);
      if (!result.success) {
        throw new ActivityCursorError();
      }
      parsed = result.data;
    } catch (error) {
      if (error instanceof ActivityCursorError) {
        throw error;
      }
      throw new ActivityCursorError();
    }

    if (parsed.runtimeId !== this.runtimeId) {
      return Object.freeze({ kind: 'reset-required' });
    }
    if (parsed.sequence > this.sequence) {
      throw new ActivityCursorError();
    }
    return Object.freeze({ kind: 'same-runtime', sequence: parsed.sequence });
  }

  snapshot(cursor?: ActivityCursor): ActivitySnapshotView {
    return this.snapshotFromValidatedCursor(this.validateCursor(cursor));
  }

  snapshotFromValidatedCursor(cursor: ValidatedActivityCursor): ActivitySnapshotView {
    let truncated = false;
    let resetRequired = false;
    let events: readonly ActivityEventView[];

    switch (cursor.kind) {
      case 'none':
        truncated = this.historyEvicted;
        events = this.entries.map((entry) => entry.view);
        break;
      case 'reset-required':
        truncated = true;
        resetRequired = true;
        events = this.entries.map((entry) => entry.view);
        break;
      case 'same-runtime': {
        if (
          !Number.isSafeInteger(cursor.sequence) ||
          cursor.sequence < 0 ||
          cursor.sequence > this.sequence
        ) {
          throw new ActivityCursorError();
        }
        const oldestSequence = this.entries[0]?.event.sequence;
        truncated = oldestSequence !== undefined && cursor.sequence < oldestSequence - 1;
        events = this.entries
          .filter((entry) => entry.event.sequence > cursor.sequence)
          .map((entry) => entry.view);
        break;
      }
      default:
        throw new ActivityCursorError();
    }

    const oldest = this.entries[0]?.event.sequence;
    return ActivitySnapshotViewSchema.parse({
      schemaVersion: ACTIVITY_SCHEMA_VERSION,
      cursor: { runtimeId: this.runtimeId, sequence: this.sequence },
      ...(oldest === undefined
        ? {}
        : { oldestAvailable: { runtimeId: this.runtimeId, sequence: oldest } }),
      truncated,
      resetRequired,
      events,
      operations: this.operations,
      calls: this.calls,
      health: this.health.snapshot(),
    });
  }

  subscribe(listener: (event: ActivityEventView) => void): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private appendGuarded(
    drafts: readonly ActivityEventDraft[],
    dropped: number,
  ):
    | { readonly accepted: true; readonly events: readonly ActivityEventView[] }
    | { readonly accepted: false; readonly code: string } {
    if (!Array.isArray(drafts)) {
      return this.rejectAppend('schema', 'invalid-event', dropped, 'invalid-event');
    }
    if (drafts.length === 0) {
      return Object.freeze({ accepted: true, events: Object.freeze([]) });
    }
    if (drafts.length > this.limits.maxSequence) {
      return this.rejectAppend('capacity', 'capacity-exceeded', dropped, 'capacity-exceeded');
    }

    const parsedDrafts: ActivityEventDraft[] = [];
    try {
      for (const draft of drafts) {
        const parsed = ActivityEventDraftSchema.safeParse(draft);
        if (!parsed.success) {
          return this.rejectAppend('schema', 'invalid-event', dropped, 'invalid-event');
        }
        parsedDrafts.push(parsed.data);
      }
    } catch {
      return this.rejectAppend('schema', 'invalid-event', dropped, 'invalid-event');
    }

    const rotates = this.sequence > this.limits.maxSequence - parsedDrafts.length;
    let candidateRuntimeId = this.runtimeId;
    let baseEntries = this.entries;
    let nextReduction = this.reduction;
    let startingSequence = this.sequence;
    if (rotates) {
      try {
        candidateRuntimeId = this.nextRuntimeId(this.runtimeId);
      } catch {
        return this.rejectAppend('schema', 'invalid-event', dropped, 'invalid-event');
      }
      baseEntries = Object.freeze([]);
      nextReduction = createEmptyReductionState();
      startingSequence = 0;
    }

    const candidates: LedgerEntry[] = [];
    for (let index = 0; index < parsedDrafts.length; index += 1) {
      let event: RetainedActivityEvent;
      let view: ActivityEventView;
      try {
        event = RetainedActivityEventSchema.parse({
          ...parsedDrafts[index],
          schemaVersion: ACTIVITY_SCHEMA_VERSION,
          runtimeId: candidateRuntimeId,
          sequence: startingSequence + index + 1,
          eventId: this.createEventId(),
          timestamp: this.now(),
        });
        view = ActivityEventViewSchema.parse(toActivityEventView(event));
      } catch {
        return this.rejectAppend('schema', 'invalid-event', dropped, 'invalid-event');
      }

      const projectedBytes = byteLength(view);
      if (projectedBytes > this.limits.maxProjectedEventBytes) {
        return this.rejectAppend('capacity', 'capacity-exceeded', dropped, 'capacity-exceeded');
      }
      const reduction = reduceActivityEvent(nextReduction, event);
      if (!reduction.ok) {
        return this.rejectAppend('reducer', 'invalid-event', dropped, reduction.code);
      }
      nextReduction = reduction.state;
      candidates.push({
        event,
        view,
        retainedBytes: byteLength(event),
        projectedBytes,
      });
    }

    const allEntries = [...baseEntries, ...candidates];
    const plan = this.planCapacity(allEntries, baseEntries.length, nextReduction);
    if (plan === undefined) {
      return this.rejectAppend('capacity', 'capacity-exceeded', dropped, 'capacity-exceeded');
    }

    this.runtimeId = candidateRuntimeId;
    this.sequence = candidates[candidates.length - 1]?.event.sequence ?? startingSequence;
    this.entries = Object.freeze([...plan.entries]);
    this.reduction = plan.reduction;
    this.operations = plan.operations;
    this.calls = plan.calls;
    if (rotates) {
      this.historyEvicted = false;
      this.health.resetForRuntime();
    } else if (plan.evictedCount > 0) {
      this.historyEvicted = true;
      this.health.recordEviction(plan.evictedCount);
    }

    const committedViews = Object.freeze(candidates.map((entry) => entry.view));
    const listenerSnapshot = [...this.listeners];
    for (const event of committedViews) {
      for (const listener of listenerSnapshot) {
        try {
          listener(event);
        } catch {
          this.health.recordListenerFailure();
        }
      }
    }
    return Object.freeze({ accepted: true, events: committedViews });
  }

  private planCapacity(
    allEntries: readonly LedgerEntry[],
    existingEntryCount: number,
    reducedState: ActivityReductionState,
  ): CapacityPlan | undefined {
    if (allEntries.length - existingEntryCount > this.limits.maxEvents) {
      return undefined;
    }

    const initialViews = materializeViews(reducedState);
    if (
      initialViews.operations.length > this.limits.maxOperations ||
      initialViews.calls.length > this.limits.maxCallAttempts
    ) {
      return undefined;
    }

    const requiredForEventLimit = Math.max(0, allEntries.length - this.limits.maxEvents);
    if (requiredForEventLimit > existingEntryCount) {
      return undefined;
    }

    for (
      let evictedCount = requiredForEventLimit;
      evictedCount <= existingEntryCount;
      evictedCount += 1
    ) {
      const entries = allEntries.slice(evictedCount);
      const reduction = removePrefixFromState(reducedState, allEntries, evictedCount);
      const views = materializeViews(reduction);
      if (
        reduction.operations.size <= this.limits.maxOperations &&
        reduction.calls.size <= this.limits.maxCallAttempts &&
        accountedStateBytes(entries, reduction, views) <= this.limits.maxTotalStateBytes
      ) {
        return {
          entries,
          reduction,
          operations: views.operations,
          calls: views.calls,
          evictedCount,
        };
      }
    }
    return undefined;
  }

  private rejectAppend(
    stage: Parameters<ActivityHealthMonitor['recordCaptureFailure']>[0],
    healthCode: ActivityHealthCode,
    dropped: number,
    code: string,
  ): { readonly accepted: false; readonly code: string } {
    this.health.recordCaptureFailure(stage, healthCode, dropped);
    return Object.freeze({ accepted: false, code });
  }

  private nextRuntimeId(previous?: string): string {
    const parsed = ActivityIdSchema.safeParse(this.createRuntimeId());
    if (!parsed.success || parsed.data === previous) {
      throw new Error('Invalid runtime id');
    }
    return parsed.data;
  }
}
