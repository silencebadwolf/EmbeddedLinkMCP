import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  ActivityEventViewSchema,
  ActivitySnapshotViewSchema,
  type ActivityCursor,
  type ActivityEventView,
  type CallAttemptPhase,
  type OperationPhase,
  type OperationProgress,
} from '@/shared/activity-contract.js';
import {
  projectedEventByteLength,
  toActivityEventView,
  type ActivityEventDraft,
  type RetainedActivityEvent,
} from '@linkterm/runtime/core/activity/activity-event';
import { ActivityHealthMonitor } from '@linkterm/runtime/core/activity/activity-health';
import { OperationLedger, type OperationLedgerOptions } from '@linkterm/runtime/core/activity/operation-ledger';

const BASE_TIME_MS = Date.UTC(2026, 6, 12, 0, 0, 0);

const COMMON_DRAFT = {
  actor: { kind: 'agent', channel: 'local-mcp' },
  surface: 'runtime',
  action: 'get_app_status',
  risk: 'read-only',
  approvalPolicy: 'none',
  authorizationSource: 'none',
  targets: [{ kind: 'runtime', id: 'target_runtime', label: 'current-runtime' }],
} as const;

type OperationDraftOverrides = Partial<
  Omit<Extract<ActivityEventDraft, { kind: 'operation-transition' }>, 'kind' | 'operationPhase'>
>;
type CallDraftOverrides = Partial<
  Omit<Extract<ActivityEventDraft, { kind: 'call-transition' }>, 'kind' | 'callPhase'>
>;
type MilestoneDraftOverrides = Partial<
  Omit<Extract<ActivityEventDraft, { kind: 'workflow-milestone' }>, 'kind' | 'progress'>
>;

function operationDraft(
  operationId: string,
  operationPhase: OperationPhase = 'requested',
  overrides: OperationDraftOverrides = {},
): ActivityEventDraft {
  return {
    ...COMMON_DRAFT,
    operationId,
    ...overrides,
    kind: 'operation-transition',
    operationPhase,
  };
}

function callDraft(
  operationId: string,
  callId: string,
  callPhase: CallAttemptPhase = 'received',
  overrides: CallDraftOverrides = {},
): ActivityEventDraft {
  return {
    ...COMMON_DRAFT,
    operationId,
    ...overrides,
    kind: 'call-transition',
    callId,
    callPhase,
  };
}

function milestoneDraft(
  operationId: string,
  current: number,
  overrides: MilestoneDraftOverrides = {},
): ActivityEventDraft {
  const progress: OperationProgress = {
    current,
    total: 10_000,
    percent: Math.min(100, current / 100),
    stepId: `step_${current}`,
    messageCode: 'workflow.running',
    evidenceRefs: [],
  };
  return {
    ...COMMON_DRAFT,
    operationId,
    surface: 'workflow',
    action: 'control-workflow.job',
    risk: 'destructive-or-unknown',
    approvalPolicy: 'human-once',
    targets: [{ kind: 'job', id: 'job_1', label: 'workflow-job' }],
    ...overrides,
    kind: 'workflow-milestone',
    progress,
  };
}

function workflowOperationDraft(operationId: string): ActivityEventDraft {
  return operationDraft(operationId, 'requested', {
    surface: 'workflow',
    action: 'control-workflow.job',
    risk: 'destructive-or-unknown',
    approvalPolicy: 'human-once',
    targets: [{ kind: 'job', id: 'job_1', label: 'workflow-job' }],
  });
}

function retainedEvent(
  draft: ActivityEventDraft,
  sequence: number,
  timestamp: string,
): RetainedActivityEvent {
  return {
    ...draft,
    schemaVersion: '1.0.0',
    runtimeId: 'runtime_1',
    sequence,
    eventId: `event_${sequence}`,
    timestamp,
  } as RetainedActivityEvent;
}

interface LedgerHarness {
  readonly ledger: OperationLedger;
  readonly health: ActivityHealthMonitor;
  readonly runtimeIdsCreated: () => number;
}

function createHarness(
  overrides: Omit<Partial<OperationLedgerOptions>, 'health'> = {},
): LedgerHarness {
  let runtimeId = 0;
  let eventId = 0;
  let timestamp = 0;
  const health = new ActivityHealthMonitor(() =>
    new Date(BASE_TIME_MS + timestamp++).toISOString(),
  );
  const ledger = new OperationLedger({
    health,
    createRuntimeId: () => `runtime_${++runtimeId}`,
    createEventId: () => `event_${++eventId}`,
    now: () => new Date(BASE_TIME_MS + timestamp++).toISOString(),
    ...overrides,
  });
  return { ledger, health, runtimeIdsCreated: () => runtimeId };
}

function expectAccepted(
  result: ReturnType<OperationLedger['appendBatch']>,
): readonly ActivityEventView[] {
  expect(result).toMatchObject({ accepted: true });
  if (!result.accepted) {
    throw new Error(`Expected accepted append, received ${result.code}`);
  }
  return result.events;
}

function expectRejected(result: ReturnType<OperationLedger['appendBatch']>, code: string): void {
  expect(result).toEqual({ accepted: false, code });
}

function expectZeroHealth(snapshot: ReturnType<OperationLedger['snapshot']>): void {
  expect(snapshot.health).toEqual({
    captureFailureCount: 0,
    droppedEventCount: 0,
    evictedEventCount: 0,
    listenerFailureCount: 0,
    policyFailureCount: 0,
    incompleteLifecycleCount: 0,
  });
}

describe('OperationLedger snapshots and atomic append', () => {
  it('returns a strict empty runtime snapshot at sequence zero', () => {
    const { ledger } = createHarness();

    const snapshot = ledger.snapshot();

    expect(snapshot).toEqual({
      schemaVersion: '1.0.0',
      cursor: { runtimeId: 'runtime_1', sequence: 0 },
      truncated: false,
      resetRequired: false,
      events: [],
      operations: [],
      calls: [],
      health: {
        captureFailureCount: 0,
        droppedEventCount: 0,
        evictedEventCount: 0,
        listenerFailureCount: 0,
        policyFailureCount: 0,
        incompleteLifecycleCount: 0,
      },
    });
    expect(ledger.validateCursor()).toEqual({ kind: 'none' });
    expect(ActivitySnapshotViewSchema.parse(snapshot)).toEqual(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('returns only retained events after a same-runtime cursor in sequence order', () => {
    const { ledger } = createHarness();
    expectAccepted(ledger.appendBatch([operationDraft('operation_1')]));
    expectAccepted(ledger.appendBatch([operationDraft('operation_1', 'running')]));
    expectAccepted(ledger.appendBatch([operationDraft('operation_1', 'succeeded')]));

    const snapshot = ledger.snapshot({ runtimeId: 'runtime_1', sequence: 1 });

    expect(snapshot.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(snapshot.cursor).toEqual({ runtimeId: 'runtime_1', sequence: 3 });
    expect(snapshot.oldestAvailable).toEqual({ runtimeId: 'runtime_1', sequence: 1 });
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.resetRequired).toBe(false);
    expect(snapshot.operations).toEqual([]);
    expectZeroHealth(snapshot);
  });

  it('assigns ledger-owned metadata and commits paired Operation/CallAttempt events atomically', () => {
    const { ledger } = createHarness();

    const events = expectAccepted(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
    );

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.map((event) => event.eventId)).toEqual(['event_1', 'event_2']);
    expect(events.every((event) => event.runtimeId === 'runtime_1')).toBe(true);
    expect(events.every((event) => ActivityEventViewSchema.safeParse(event).success)).toBe(true);
    const snapshot = ledger.snapshot();
    expect(snapshot.events).toEqual(events);
    expect(snapshot.operations).toHaveLength(1);
    expect(snapshot.operations[0]).toMatchObject({
      operationId: 'operation_1',
      operationPhase: 'requested',
    });
    expect(snapshot.calls).toHaveLength(1);
    expect(snapshot.calls[0]).toMatchObject({ callId: 'call_1', callPhase: 'received' });
    expectZeroHealth(snapshot);
  });

  it('strict-parses all drafts before commit and drops a malformed batch without an orphan', () => {
    const { ledger } = createHarness();
    const malformed = {
      ...callDraft('operation_1', 'call_1'),
      producerOwnedSequence: 99,
    } as unknown as ActivityEventDraft;

    expectRejected(ledger.appendBatch([operationDraft('operation_1'), malformed]), 'invalid-event');

    const rejected = ledger.snapshot();
    expect(rejected.cursor.sequence).toBe(0);
    expect(rejected.events).toEqual([]);
    expect(rejected.operations).toEqual([]);
    expect(rejected.calls).toEqual([]);
    expect(rejected.health).toMatchObject({
      captureFailureCount: 1,
      droppedEventCount: 2,
      evictedEventCount: 0,
    });

    const accepted = expectAccepted(ledger.appendBatch([operationDraft('operation_2')]));
    expect(accepted[0]?.sequence).toBe(1);
  });

  it('rejects a reducer-invalid batch as a total no-op with exact dropped accounting', () => {
    const { ledger } = createHarness();

    expectRejected(
      ledger.appendBatch([
        operationDraft('operation_1'),
        callDraft('operation_1', 'call_1', 'started'),
      ]),
      'illegal-call-transition',
    );

    expect(ledger.snapshot()).toMatchObject({
      cursor: { runtimeId: 'runtime_1', sequence: 0 },
      events: [],
      operations: [],
      calls: [],
      health: {
        captureFailureCount: 1,
        droppedEventCount: 2,
        evictedEventCount: 0,
      },
    });
  });
});

describe('OperationLedger production defaults', () => {
  it('retains exactly 5,000 events before event-count eviction is required', () => {
    const { ledger } = createHarness();
    const drafts: ActivityEventDraft[] = [workflowOperationDraft('operation_1')];
    for (let sequence = 2; sequence <= 5_000; sequence += 1) {
      drafts.push(milestoneDraft('operation_1', sequence));
    }

    expect(expectAccepted(ledger.appendBatch(drafts))).toHaveLength(5_000);
    expectZeroHealth(ledger.snapshot());

    expectAccepted(ledger.appendBatch([milestoneDraft('operation_1', 5_001)]));
    const snapshot = ledger.snapshot();
    expect(snapshot.events).toHaveLength(5_000);
    expect(snapshot.oldestAvailable).toEqual({ runtimeId: 'runtime_1', sequence: 2 });
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 0,
      droppedEventCount: 0,
      evictedEventCount: 1,
    });
  });

  it('pins exactly 1,000 active Operations under the default tracked-record limit', () => {
    const { ledger } = createHarness();
    const drafts = Array.from({ length: 1_000 }, (_, index) =>
      operationDraft(`operation_${index + 1}`),
    );

    expect(expectAccepted(ledger.appendBatch(drafts))).toHaveLength(1_000);
    expectRejected(ledger.appendBatch([operationDraft('operation_1001')]), 'capacity-exceeded');

    const snapshot = ledger.snapshot();
    expect(snapshot.operations).toHaveLength(1_000);
    expect(snapshot.events).toHaveLength(1_000);
    expect(snapshot.cursor.sequence).toBe(1_000);
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 1,
      droppedEventCount: 1,
      evictedEventCount: 0,
    });
  });

  it('pins exactly 2,000 active CallAttempts under the default tracked-record limit', () => {
    const { ledger } = createHarness();
    const drafts: ActivityEventDraft[] = [operationDraft('operation_1')];
    for (let call = 1; call <= 2_000; call += 1) {
      drafts.push(callDraft('operation_1', `call_${call}`));
    }

    expect(expectAccepted(ledger.appendBatch(drafts))).toHaveLength(2_001);
    expectRejected(
      ledger.appendBatch([callDraft('operation_1', 'call_2001')]),
      'capacity-exceeded',
    );

    const snapshot = ledger.snapshot();
    expect(snapshot.calls).toHaveLength(2_000);
    expect(snapshot.events).toHaveLength(2_001);
    expect(snapshot.cursor.sequence).toBe(2_001);
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 1,
      droppedEventCount: 1,
      evictedEventCount: 0,
    });
  });

  it('accepts a 16 KiB projected event and rejects the next byte', () => {
    const draft = operationDraft('operation_1');
    const timestampPrefix = '2026-07-12T00:00:00.';
    const baseTimestamp = `${timestampPrefix}0Z`;
    const baseLength = projectedEventByteLength(retainedEvent(draft, 1, baseTimestamp));
    const addedBytes = 16 * 1_024 - baseLength;
    expect(addedBytes).toBeGreaterThanOrEqual(0);
    const atLimitTimestamp = `${timestampPrefix}${'0'.repeat(addedBytes + 1)}Z`;
    const overLimitTimestamp = `${timestampPrefix}${'0'.repeat(addedBytes + 2)}Z`;
    expect(projectedEventByteLength(retainedEvent(draft, 1, atLimitTimestamp))).toBe(16 * 1_024);

    const atLimit = createHarness({ now: () => atLimitTimestamp });
    expectAccepted(atLimit.ledger.appendBatch([draft]));
    expectZeroHealth(atLimit.ledger.snapshot());

    const overLimit = createHarness({ now: () => overLimitTimestamp });
    expectRejected(overLimit.ledger.appendBatch([draft]), 'capacity-exceeded');
    expect(overLimit.ledger.snapshot().health).toMatchObject({
      captureFailureCount: 1,
      droppedEventCount: 1,
      evictedEventCount: 0,
    });
  });

  it('enforces the deterministic 16 MiB total-state accounting formula', () => {
    const totalLimit = 16 * 1_024 * 1_024;
    const timestamp = `2026-07-12T00:00:00.${'0'.repeat(2_000)}Z`;
    const drafts: ActivityEventDraft[] = [];
    let retainedAndProjectedBytes = 0;
    let accountedBytes = 0;
    let firstView: ActivityEventView | undefined;

    for (let sequence = 1; sequence <= 5_000 && accountedBytes <= totalLimit; sequence += 1) {
      const draft =
        sequence === 1
          ? workflowOperationDraft('operation_1')
          : milestoneDraft('operation_1', sequence);
      drafts.push(draft);
      const retained = retainedEvent(draft, sequence, timestamp);
      const projected = toActivityEventView(retained);
      firstView ??= projected;
      retainedAndProjectedBytes +=
        Buffer.byteLength(JSON.stringify(retained), 'utf8') +
        Buffer.byteLength(JSON.stringify(projected), 'utf8');

      const firstCommon: Record<string, unknown> = { ...firstView };
      delete firstCommon.kind;
      const activeOperation = {
        ...firstCommon,
        operationPhase: 'requested',
        updatedSequence: sequence,
        ...(draft.kind === 'workflow-milestone' ? { progress: draft.progress } : {}),
      };
      accountedBytes =
        retainedAndProjectedBytes +
        drafts.length * 64 +
        256 +
        Buffer.byteLength(JSON.stringify(activeOperation), 'utf8');
    }

    expect(accountedBytes).toBeGreaterThan(totalLimit);
    expect(drafts.length).toBeLessThanOrEqual(5_000);
    const fittingDrafts = drafts.slice(0, -1);

    const fitting = createHarness({ now: () => timestamp });
    expect(expectAccepted(fitting.ledger.appendBatch(fittingDrafts))).toHaveLength(
      fittingDrafts.length,
    );
    expect(fitting.health.snapshot()).toMatchObject({
      captureFailureCount: 0,
      droppedEventCount: 0,
      evictedEventCount: 0,
    });

    const overflowing = createHarness({ now: () => timestamp });
    expectRejected(overflowing.ledger.appendBatch(drafts), 'capacity-exceeded');
    expect(overflowing.ledger.snapshot()).toMatchObject({
      cursor: { sequence: 0 },
      events: [],
      health: {
        captureFailureCount: 1,
        droppedEventCount: drafts.length,
        evictedEventCount: 0,
      },
    });
  });
});

describe('OperationLedger bounded retention', () => {
  it('rejects a candidate batch larger than an injected event limit without evicting candidates', () => {
    const { ledger } = createHarness({ maxEvents: 1 });

    expectRejected(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
      'capacity-exceeded',
    );

    expect(ledger.snapshot()).toMatchObject({
      cursor: { sequence: 0 },
      events: [],
      health: {
        captureFailureCount: 1,
        droppedEventCount: 2,
        evictedEventCount: 0,
      },
    });
  });

  it('rejects a batch larger than an injected tracked-Operation limit', () => {
    const { ledger } = createHarness({ maxOperations: 1 });

    expectRejected(
      ledger.appendBatch([operationDraft('operation_1'), operationDraft('operation_2')]),
      'capacity-exceeded',
    );

    expect(ledger.snapshot()).toMatchObject({
      cursor: { sequence: 0 },
      operations: [],
      health: { captureFailureCount: 1, droppedEventCount: 2, evictedEventCount: 0 },
    });
  });

  it('rejects a batch larger than an injected tracked-CallAttempt limit', () => {
    const { ledger } = createHarness({ maxCallAttempts: 1 });

    expectRejected(
      ledger.appendBatch([
        operationDraft('operation_1'),
        callDraft('operation_1', 'call_1'),
        callDraft('operation_1', 'call_2'),
      ]),
      'capacity-exceeded',
    );

    expect(ledger.snapshot()).toMatchObject({
      cursor: { sequence: 0 },
      calls: [],
      health: { captureFailureCount: 1, droppedEventCount: 3, evictedEventCount: 0 },
    });
  });

  it('rejects an event over an injected projected-event byte limit', () => {
    const { ledger } = createHarness({ maxProjectedEventBytes: 1 });

    expectRejected(ledger.appendBatch([operationDraft('operation_1')]), 'capacity-exceeded');

    expect(ledger.snapshot()).toMatchObject({
      cursor: { sequence: 0 },
      health: { captureFailureCount: 1, droppedEventCount: 1, evictedEventCount: 0 },
    });
  });

  it('rejects an atomic begin batch over an injected total-state byte limit', () => {
    const { ledger } = createHarness({ maxTotalStateBytes: 1 });

    expectRejected(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
      'capacity-exceeded',
    );

    expect(ledger.snapshot()).toMatchObject({
      cursor: { sequence: 0 },
      events: [],
      health: { captureFailureCount: 1, droppedEventCount: 2, evictedEventCount: 0 },
    });
  });

  it('accounts exact internal, projected, index, Operation, and CallAttempt bytes', () => {
    const operation = operationDraft('operation_1');
    const call = callDraft('operation_1', 'call_1');
    const retainedOperation = retainedEvent(operation, 1, new Date(BASE_TIME_MS).toISOString());
    const retainedCall = retainedEvent(call, 2, new Date(BASE_TIME_MS + 1).toISOString());
    const projectedOperation = toActivityEventView(retainedOperation);
    const projectedCall = toActivityEventView(retainedCall);
    if (
      projectedOperation.kind !== 'operation-transition' ||
      projectedCall.kind !== 'call-transition'
    ) {
      throw new Error('Expected deterministic Operation and CallAttempt views');
    }
    const operationFields: Record<string, unknown> = { ...projectedOperation };
    const callFields: Record<string, unknown> = { ...projectedCall };
    delete operationFields.kind;
    delete callFields.kind;
    const operationView = { ...operationFields, updatedSequence: 1 };
    const callView = { ...callFields, updatedSequence: 2 };
    const exactBytes =
      Buffer.byteLength(JSON.stringify(retainedOperation), 'utf8') +
      Buffer.byteLength(JSON.stringify(retainedCall), 'utf8') +
      Buffer.byteLength(JSON.stringify(projectedOperation), 'utf8') +
      Buffer.byteLength(JSON.stringify(projectedCall), 'utf8') +
      Buffer.byteLength(JSON.stringify(operationView), 'utf8') +
      Buffer.byteLength(JSON.stringify(callView), 'utf8') +
      2 * 64 +
      256 +
      192;

    const atLimit = createHarness({ maxTotalStateBytes: exactBytes });
    expectAccepted(atLimit.ledger.appendBatch([operation, call]));
    expectZeroHealth(atLimit.ledger.snapshot());

    const belowLimit = createHarness({ maxTotalStateBytes: exactBytes - 1 });
    expectRejected(belowLimit.ledger.appendBatch([operation, call]), 'capacity-exceeded');
    expect(belowLimit.ledger.snapshot().health).toMatchObject({
      captureFailureCount: 1,
      droppedEventCount: 2,
      evictedEventCount: 0,
    });
  });

  it('evicts only the minimum existing prefix and keeps active projections pinned', () => {
    const { ledger } = createHarness({ maxEvents: 2 });
    expectAccepted(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
    );

    const committed = expectAccepted(
      ledger.appendBatch([
        callDraft('operation_1', 'call_1', 'started'),
        operationDraft('operation_1', 'running'),
      ]),
    );

    expect(committed.map((event) => event.sequence)).toEqual([3, 4]);
    const snapshot = ledger.snapshot();
    expect(snapshot.events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(snapshot.oldestAvailable).toEqual({ runtimeId: 'runtime_1', sequence: 3 });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.operations).toEqual([
      expect.objectContaining({ operationId: 'operation_1', operationPhase: 'running' }),
    ]);
    expect(snapshot.calls).toEqual([
      expect.objectContaining({ callId: 'call_1', callPhase: 'started' }),
    ]);
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 0,
      droppedEventCount: 0,
      evictedEventCount: 2,
    });
  });

  it('does not commit prospective eviction when an active Operation remains pinned', () => {
    const { ledger } = createHarness({ maxOperations: 1 });
    expectAccepted(ledger.appendBatch([operationDraft('operation_1')]));

    expectRejected(ledger.appendBatch([operationDraft('operation_2')]), 'capacity-exceeded');

    const snapshot = ledger.snapshot();
    expect(snapshot.cursor.sequence).toBe(1);
    expect(snapshot.events.map((event) => event.operationId)).toEqual(['operation_1']);
    expect(snapshot.operations.map((operation) => operation.operationId)).toEqual(['operation_1']);
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 1,
      droppedEventCount: 1,
      evictedEventCount: 0,
    });
  });

  it('does not release or evict an active CallAttempt to admit another call', () => {
    const { ledger } = createHarness({ maxCallAttempts: 1 });
    expectAccepted(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
    );

    expectRejected(ledger.appendBatch([callDraft('operation_1', 'call_2')]), 'capacity-exceeded');

    const snapshot = ledger.snapshot();
    expect(snapshot.cursor.sequence).toBe(2);
    expect(snapshot.calls.map((call) => call.callId)).toEqual(['call_1']);
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 1,
      droppedEventCount: 1,
      evictedEventCount: 0,
    });
  });

  it('releases a terminal Operation only after its final retained reference leaves', () => {
    const { ledger } = createHarness({ maxOperations: 1 });
    expectAccepted(
      ledger.appendBatch([
        operationDraft('operation_1'),
        operationDraft('operation_1', 'running'),
        operationDraft('operation_1', 'succeeded'),
      ]),
    );

    const accepted = expectAccepted(ledger.appendBatch([operationDraft('operation_2')]));

    expect(accepted[0]?.sequence).toBe(4);
    const snapshot = ledger.snapshot();
    expect(snapshot.events.map((event) => event.operationId)).toEqual(['operation_2']);
    expect(snapshot.operations.map((operation) => operation.operationId)).toEqual(['operation_2']);
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 0,
      droppedEventCount: 0,
      evictedEventCount: 3,
    });
  });

  it('releases a terminal CallAttempt only after its final call event leaves', () => {
    const { ledger } = createHarness({ maxCallAttempts: 1 });
    expectAccepted(
      ledger.appendBatch([
        operationDraft('operation_1'),
        callDraft('operation_1', 'call_1'),
        callDraft('operation_1', 'call_1', 'started'),
        callDraft('operation_1', 'call_1', 'succeeded'),
      ]),
    );

    const accepted = expectAccepted(ledger.appendBatch([callDraft('operation_1', 'call_2')]));

    expect(accepted[0]?.sequence).toBe(5);
    const snapshot = ledger.snapshot();
    expect(snapshot.events.map((event) => event.eventId)).toEqual(['event_5']);
    expect(snapshot.operations.map((operation) => operation.operationId)).toEqual(['operation_1']);
    expect(snapshot.calls.map((call) => call.callId)).toEqual(['call_2']);
    expect(snapshot.health.evictedEventCount).toBe(4);
  });

  it('keeps a terminal event queryable only while it remains in the retained window', () => {
    const { ledger } = createHarness({ maxEvents: 1 });
    expectAccepted(ledger.appendBatch([operationDraft('operation_1')]));
    expectAccepted(ledger.appendBatch([operationDraft('operation_1', 'running')]));
    expectAccepted(ledger.appendBatch([operationDraft('operation_1', 'succeeded')]));

    const retainedTerminal = ledger.snapshot({ runtimeId: 'runtime_1', sequence: 2 });
    expect(retainedTerminal.events).toEqual([
      expect.objectContaining({ operationId: 'operation_1', operationPhase: 'succeeded' }),
    ]);
    expect(retainedTerminal.operations).toEqual([]);

    expectAccepted(ledger.appendBatch([operationDraft('operation_2')]));
    const afterEviction = ledger.snapshot({ runtimeId: 'runtime_1', sequence: 2 });
    expect(afterEviction.events.map((event) => event.operationId)).toEqual(['operation_2']);
    expect(afterEviction.events).not.toContainEqual(
      expect.objectContaining({ operationId: 'operation_1', operationPhase: 'succeeded' }),
    );
    expect(afterEviction.truncated).toBe(true);
  });
});

describe('OperationLedger cursor and runtime semantics', () => {
  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects non-positive or unsafe maxSequence option %s',
    (maxSequence) => {
      expect(() => createHarness({ maxSequence })).toThrow(/positive safe integer/u);
    },
  );

  it('marks a missing cursor truncated after eviction and honors oldestAvailable minus one', () => {
    const { ledger } = createHarness({ maxEvents: 2 });
    expectAccepted(ledger.appendBatch([operationDraft('operation_1')]));
    expectAccepted(ledger.appendBatch([operationDraft('operation_1', 'running')]));
    expectAccepted(ledger.appendBatch([operationDraft('operation_1', 'succeeded')]));

    const initialReader = ledger.snapshot();
    expect(initialReader.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(initialReader.oldestAvailable).toEqual({ runtimeId: 'runtime_1', sequence: 2 });
    expect(initialReader.truncated).toBe(true);

    const boundary = ledger.snapshot({ runtimeId: 'runtime_1', sequence: 1 });
    expect(boundary.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(boundary.truncated).toBe(false);

    const beforeBoundary = ledger.snapshot({ runtimeId: 'runtime_1', sequence: 0 });
    expect(beforeBoundary.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(beforeBoundary.truncated).toBe(true);
  });

  it('returns reset-required semantics and the full retained window for another runtime', () => {
    const { ledger } = createHarness();
    expectAccepted(ledger.appendBatch([operationDraft('operation_1')]));

    expect(ledger.validateCursor({ runtimeId: 'older_runtime', sequence: 999 })).toEqual({
      kind: 'reset-required',
    });
    const snapshot = ledger.snapshot({ runtimeId: 'older_runtime', sequence: 999 });
    expect(snapshot.events.map((event) => event.sequence)).toEqual([1]);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.resetRequired).toBe(true);
    expect(snapshot.oldestAvailable).toEqual({ runtimeId: 'runtime_1', sequence: 1 });
  });

  it('validates a current cursor token for synchronous snapshot use', () => {
    const { ledger } = createHarness();
    expectAccepted(ledger.appendBatch([operationDraft('operation_1')]));
    const validated = ledger.validateCursor({ runtimeId: 'runtime_1', sequence: 1 });

    expect(validated).toEqual({ kind: 'same-runtime', sequence: 1 });
    expect(ledger.snapshotFromValidatedCursor(validated)).toMatchObject({
      cursor: { runtimeId: 'runtime_1', sequence: 1 },
      truncated: false,
      resetRequired: false,
      events: [],
    });
  });

  it.each([
    ['null', null],
    ['missing runtime id', { sequence: 0 }],
    ['invalid runtime id', { runtimeId: 'invalid runtime', sequence: 0 }],
    ['unknown field', { runtimeId: 'runtime_1', sequence: 0, extra: true }],
    ['fractional sequence', { runtimeId: 'runtime_1', sequence: 0.5 }],
    ['negative sequence', { runtimeId: 'runtime_1', sequence: -1 }],
    ['NaN sequence', { runtimeId: 'runtime_1', sequence: Number.NaN }],
    ['infinite sequence', { runtimeId: 'runtime_1', sequence: Number.POSITIVE_INFINITY }],
    ['unsafe sequence', { runtimeId: 'runtime_1', sequence: Number.MAX_SAFE_INTEGER + 1 }],
    ['future sequence', { runtimeId: 'runtime_1', sequence: 2 }],
  ])('rejects a %s cursor without changing ledger or health state', (_name, rawCursor) => {
    const { ledger } = createHarness();
    expectAccepted(ledger.appendBatch([operationDraft('operation_1')]));
    const before = ledger.snapshot();

    expect(() => ledger.validateCursor(rawCursor as ActivityCursor)).toThrowError(
      expect.objectContaining({
        name: 'ActivityCursorError',
        message: 'Invalid activity cursor',
      }),
    );

    expect(ledger.snapshot()).toEqual(before);
  });

  it('rotates atomically before the next sequence would exceed maxSequence', () => {
    const { ledger, runtimeIdsCreated } = createHarness({ maxSequence: 2 });
    expectAccepted(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
    );
    const oldCursor = ledger.snapshot().cursor;

    const rotated = expectAccepted(ledger.appendBatch([operationDraft('operation_2')]));

    expect(rotated).toEqual([
      expect.objectContaining({ runtimeId: 'runtime_2', sequence: 1, operationId: 'operation_2' }),
    ]);
    expect(runtimeIdsCreated()).toBe(2);
    const oldReader = ledger.snapshot(oldCursor);
    expect(oldReader).toMatchObject({
      cursor: { runtimeId: 'runtime_2', sequence: 1 },
      oldestAvailable: { runtimeId: 'runtime_2', sequence: 1 },
      truncated: true,
      resetRequired: true,
    });
    expect(oldReader.events.map((event) => event.operationId)).toEqual(['operation_2']);
    expectZeroHealth(oldReader);
  });

  it('does not clear the old runtime when a prospective rotation batch fails', () => {
    const { ledger, runtimeIdsCreated } = createHarness({ maxSequence: 2 });
    expectAccepted(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
    );

    expectRejected(
      ledger.appendBatch([operationDraft('operation_2', 'running')]),
      'unknown-operation',
    );

    const unchanged = ledger.snapshot();
    expect(unchanged.cursor).toEqual({ runtimeId: 'runtime_1', sequence: 2 });
    expect(unchanged.events.map((event) => event.operationId)).toEqual([
      'operation_1',
      'operation_1',
    ]);
    expect(unchanged.health).toMatchObject({ captureFailureCount: 1, droppedEventCount: 1 });
    expect(runtimeIdsCreated()).toBe(2);

    const rotated = expectAccepted(ledger.appendBatch([operationDraft('operation_2')]));
    expect(rotated[0]).toMatchObject({ runtimeId: 'runtime_3', sequence: 1 });
    expectZeroHealth(ledger.snapshot());
  });

  it('drops a batch that cannot fit within one runtime sequence space', () => {
    const { ledger, runtimeIdsCreated } = createHarness({ maxSequence: 2 });

    expectRejected(
      ledger.appendBatch([
        operationDraft('operation_1'),
        callDraft('operation_1', 'call_1'),
        callDraft('operation_1', 'call_2'),
      ]),
      'capacity-exceeded',
    );

    expect(ledger.snapshot()).toMatchObject({
      cursor: { runtimeId: 'runtime_1', sequence: 0 },
      events: [],
      health: { captureFailureCount: 1, droppedEventCount: 3, evictedEventCount: 0 },
    });
    expect(runtimeIdsCreated()).toBe(1);
    expect(expectAccepted(ledger.appendBatch([operationDraft('operation_2')]))[0]?.sequence).toBe(
      1,
    );
  });
});

describe('OperationLedger subscribers', () => {
  it('isolates listener throws and preserves ordered delivery to other listeners', () => {
    const { ledger } = createHarness();
    const received: number[] = [];
    ledger.subscribe(() => {
      throw new Error('listener payload');
    });
    ledger.subscribe((event) => received.push(event.sequence));

    expect(() =>
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
    ).not.toThrow();

    expect(received).toEqual([1, 2]);
    expect(ledger.snapshot()).toMatchObject({
      cursor: { sequence: 2 },
      health: {
        captureFailureCount: 0,
        droppedEventCount: 0,
        evictedEventCount: 0,
        listenerFailureCount: 2,
      },
    });
  });

  it('unsubscribes idempotently and sends no later callbacks', () => {
    const { ledger } = createHarness();
    const listener = vi.fn();
    const unsubscribe = ledger.subscribe(listener);
    expectAccepted(ledger.appendBatch([operationDraft('operation_1')]));

    unsubscribe();
    unsubscribe();
    expectAccepted(ledger.appendBatch([operationDraft('operation_1', 'running')]));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('uses one listener snapshot so unsubscribe during notification affects only later batches', () => {
    const { ledger } = createHarness();
    const receivedBySecond: number[] = [];
    let unsubscribeSecond = () => undefined;
    ledger.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = ledger.subscribe((event) => receivedBySecond.push(event.sequence));

    expectAccepted(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
    );
    expect(receivedBySecond).toEqual([1, 2]);

    expectAccepted(ledger.appendBatch([operationDraft('operation_1', 'running')]));
    expect(receivedBySecond).toEqual([1, 2]);
  });

  it('rejects re-entrant append during notification without disturbing the committed batch', () => {
    const { ledger } = createHarness();
    let nestedResult: ReturnType<OperationLedger['appendBatch']> | undefined;
    ledger.subscribe(() => {
      nestedResult ??= ledger.appendBatch([operationDraft('operation_2')]);
    });

    const outer = expectAccepted(
      ledger.appendBatch([operationDraft('operation_1'), callDraft('operation_1', 'call_1')]),
    );

    expect(outer.map((event) => event.sequence)).toEqual([1, 2]);
    expect(nestedResult).toEqual({ accepted: false, code: 'reentrant-append' });
    const snapshot = ledger.snapshot();
    expect(snapshot.cursor.sequence).toBe(2);
    expect(snapshot.events.map((event) => event.operationId)).toEqual([
      'operation_1',
      'operation_1',
    ]);
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 1,
      droppedEventCount: 1,
      evictedEventCount: 0,
      listenerFailureCount: 0,
    });

    expect(expectAccepted(ledger.appendBatch([operationDraft('operation_2')]))[0]?.sequence).toBe(
      3,
    );
  });
});
