import { describe, expect, it } from 'vitest';
import {
  CallAttemptViewSchema,
  OperationViewSchema,
  type ActivitySurface,
  type CallAttemptPhase,
  type OperationPhase,
} from '@/shared/activity-contract.js';
import type {
  RetainedActivityEvent,
  RetainedCallTransition,
  RetainedOperationTransition,
  RetainedWorkflowMilestone,
} from '@linkterm/runtime/core/activity/activity-event';
import {
  classifyOperationsAtRuntimeEnd,
  createEmptyReductionState,
  reduceActivityEvent,
  type ActivityReductionState,
  type ReductionFailureCode,
  type ReductionResult,
} from '@linkterm/runtime/core/activity/operation-state';

const operationEdges = {
  requested: ['awaiting-approval', 'blocked', 'queued', 'running', 'rejected'],
  'awaiting-approval': ['blocked', 'queued', 'running', 'denied', 'expired', 'superseded'],
  blocked: ['queued', 'running', 'expired', 'superseded'],
  queued: ['running', 'cancel-requested', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  running: ['cancel-requested', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  'cancel-requested': ['succeeded', 'failed', 'cancelled', 'interrupted'],
} as const;

const callEdges = {
  received: ['approval-required', 'rejected', 'started'],
  started: ['succeeded', 'failed'],
} as const;

const operationPhases = [
  'requested',
  'awaiting-approval',
  'blocked',
  'queued',
  'running',
  'cancel-requested',
  'succeeded',
  'failed',
  'rejected',
  'denied',
  'expired',
  'superseded',
  'cancelled',
  'interrupted',
] as const satisfies readonly OperationPhase[];

const operationTerminals = [
  'succeeded',
  'failed',
  'rejected',
  'denied',
  'expired',
  'superseded',
  'cancelled',
  'interrupted',
] as const satisfies readonly OperationPhase[];

const callPhases = [
  'received',
  'approval-required',
  'rejected',
  'started',
  'succeeded',
  'failed',
] as const satisfies readonly CallAttemptPhase[];

const callTerminals = [
  'approval-required',
  'rejected',
  'succeeded',
  'failed',
] as const satisfies readonly CallAttemptPhase[];

const operationPaths: Record<OperationPhase, readonly OperationPhase[]> = {
  requested: ['requested'],
  'awaiting-approval': ['requested', 'awaiting-approval'],
  blocked: ['requested', 'blocked'],
  queued: ['requested', 'queued'],
  running: ['requested', 'running'],
  'cancel-requested': ['requested', 'running', 'cancel-requested'],
  succeeded: ['requested', 'running', 'succeeded'],
  failed: ['requested', 'running', 'failed'],
  rejected: ['requested', 'rejected'],
  denied: ['requested', 'awaiting-approval', 'denied'],
  expired: ['requested', 'blocked', 'expired'],
  superseded: ['requested', 'blocked', 'superseded'],
  cancelled: ['requested', 'running', 'cancelled'],
  interrupted: ['requested', 'running', 'interrupted'],
};

const callPaths: Record<CallAttemptPhase, readonly CallAttemptPhase[]> = {
  received: ['received'],
  'approval-required': ['received', 'approval-required'],
  rejected: ['received', 'rejected'],
  started: ['received', 'started'],
  succeeded: ['received', 'started', 'succeeded'],
  failed: ['received', 'started', 'failed'],
};

type OperationOverrides = Partial<Omit<RetainedOperationTransition, 'kind' | 'operationPhase'>>;
type CallOverrides = Partial<Omit<RetainedCallTransition, 'kind' | 'callPhase'>>;
type MilestoneOverrides = Partial<Omit<RetainedWorkflowMilestone, 'kind' | 'progress'>>;

function operationEvent(
  operationPhase: OperationPhase,
  overrides: OperationOverrides = {},
): RetainedOperationTransition {
  const sequence = overrides.sequence ?? 1;
  const operationId = overrides.operationId ?? 'operation_1';
  return {
    schemaVersion: '1.0.0',
    runtimeId: 'runtime_1',
    sequence,
    eventId: overrides.eventId ?? `${operationId}.operation.${sequence}.${operationPhase}`,
    timestamp: overrides.timestamp ?? `2026-07-12T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    operationId,
    actor: { kind: 'agent', channel: 'local-mcp' },
    surface: 'runtime',
    action: 'get_app_status',
    risk: 'read-only',
    approvalPolicy: 'none',
    authorizationSource: 'none',
    targets: [{ kind: 'runtime', id: 'runtime_1', label: 'current-runtime' }],
    ...overrides,
    kind: 'operation-transition',
    operationPhase,
  };
}

function callEvent(
  callPhase: CallAttemptPhase,
  overrides: CallOverrides = {},
): RetainedCallTransition {
  const sequence = overrides.sequence ?? 2;
  const operationId = overrides.operationId ?? 'operation_1';
  const callId = overrides.callId ?? 'call_1';
  return {
    schemaVersion: '1.0.0',
    runtimeId: 'runtime_1',
    sequence,
    eventId: overrides.eventId ?? `${callId}.call.${sequence}.${callPhase}`,
    timestamp: overrides.timestamp ?? `2026-07-12T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    operationId,
    actor: { kind: 'agent', channel: 'local-mcp' },
    surface: 'runtime',
    action: 'get_app_status',
    risk: 'read-only',
    approvalPolicy: 'none',
    authorizationSource: 'none',
    targets: [{ kind: 'runtime', id: 'runtime_1', label: 'current-runtime' }],
    ...overrides,
    kind: 'call-transition',
    callId,
    callPhase,
  };
}

function milestoneEvent(overrides: MilestoneOverrides = {}): RetainedWorkflowMilestone {
  const sequence = overrides.sequence ?? 3;
  const operationId = overrides.operationId ?? 'operation_1';
  return {
    schemaVersion: '1.0.0',
    runtimeId: 'runtime_1',
    sequence,
    eventId: overrides.eventId ?? `${operationId}.milestone.${sequence}`,
    timestamp: overrides.timestamp ?? `2026-07-12T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    operationId,
    actor: { kind: 'agent', channel: 'local-mcp' },
    surface: 'workflow',
    action: 'control-workflow.job',
    risk: 'destructive-or-unknown',
    approvalPolicy: 'human-once',
    authorizationSource: 'none',
    targets: [{ kind: 'job', id: 'job_1', label: 'workflow-job' }],
    ...overrides,
    kind: 'workflow-milestone',
    progress: {
      current: 1,
      total: 4,
      percent: 25,
      stepId: 'step_1',
      messageCode: 'workflow.running',
      evidenceRefs: [{ kind: 'job-step', id: 'job_1', cursorStart: 0, cursorEnd: 1 }],
    },
  };
}

function accept(
  state: ActivityReductionState,
  event: RetainedActivityEvent,
): ActivityReductionState {
  const result = reduceActivityEvent(state, event);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) {
    throw new Error(`Expected ${event.eventId} to be accepted, received ${result.code}`);
  }
  return result.state;
}

function stateSnapshot(state: ActivityReductionState): unknown {
  return {
    operations: [...state.operations.entries()],
    calls: [...state.calls.entries()],
    acceptedEventIds: [...state.acceptedEventIds],
  };
}

function expectRejected(
  state: ActivityReductionState,
  event: RetainedActivityEvent,
  code: ReductionFailureCode,
): void {
  const before = stateSnapshot(state);
  const operations = state.operations;
  const calls = state.calls;
  const acceptedEventIds = state.acceptedEventIds;

  expect(reduceActivityEvent(state, event)).toEqual({ ok: false, code });
  expect(stateSnapshot(state)).toEqual(before);
  expect(state.operations).toBe(operations);
  expect(state.calls).toBe(calls);
  expect(state.acceptedEventIds).toBe(acceptedEventIds);
  expect(state.acceptedEventIds.has(event.eventId)).toBe(false);
}

function stateAtOperationPhase(
  phase: OperationPhase,
  options: { operationId?: string; surface?: ActivitySurface; action?: string } = {},
): ActivityReductionState {
  let state = createEmptyReductionState();
  for (const [index, nextPhase] of operationPaths[phase].entries()) {
    const overrides: OperationOverrides = {
      sequence: index + 1,
      eventId: `${options.operationId ?? 'operation_1'}.path.${index + 1}.${nextPhase}`,
      ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
      ...(options.surface === undefined ? {} : { surface: options.surface }),
      ...(options.action === undefined ? {} : { action: options.action }),
    };
    state = accept(state, operationEvent(nextPhase, overrides));
  }
  return state;
}

function stateAtCallPhase(phase: CallAttemptPhase): ActivityReductionState {
  let state = stateAtOperationPhase('requested');
  for (const [index, nextPhase] of callPaths[phase].entries()) {
    state = accept(
      state,
      callEvent(nextPhase, {
        sequence: index + 2,
        eventId: `call_1.path.${index + 2}.${nextPhase}`,
      }),
    );
  }
  return state;
}

function operationTransitionIsAllowed(from: OperationPhase, to: OperationPhase): boolean {
  const edges = operationEdges[from as keyof typeof operationEdges] as
    | readonly OperationPhase[]
    | undefined;
  return edges?.includes(to) ?? false;
}

function callTransitionIsAllowed(from: CallAttemptPhase, to: CallAttemptPhase): boolean {
  const edges = callEdges[from as keyof typeof callEdges] as
    | readonly CallAttemptPhase[]
    | undefined;
  return edges?.includes(to) ?? false;
}

describe('operation reducer adjacency', () => {
  const cartesian = operationPhases.flatMap((from) => operationPhases.map((to) => ({ from, to })));

  it.each(cartesian)('reduces $from -> $to according to the exact table', ({ from, to }) => {
    const state = stateAtOperationPhase(from);
    const beforeCalls = state.calls;
    const event = operationEvent(to, {
      sequence: 20,
      eventId: `candidate.operation.${from}.${to}`,
    });
    const result = reduceActivityEvent(state, event);

    if (operationTerminals.includes(from)) {
      expect(result).toEqual({ ok: false, code: 'terminal-operation' });
      expect(state.operations.get('operation_1')?.phase).toBe(from);
      return;
    }

    if (operationTransitionIsAllowed(from, to)) {
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error(`Expected ${from} -> ${to} to be accepted`);
      expect(result.state.operations.get('operation_1')?.phase).toBe(to);
      expect(result.state.operations.get('operation_1')?.updatedSequence).toBe(20);
      expect(result.state.calls).toBe(beforeCalls);
      return;
    }

    expect(result).toEqual({ ok: false, code: 'illegal-operation-transition' });
    expect(state.operations.get('operation_1')?.phase).toBe(from);
  });

  it.each(operationPhases.filter((phase) => phase !== 'requested'))(
    'rejects unknown Operation creation directly at %s',
    (phase) => {
      expectRejected(
        createEmptyReductionState(),
        operationEvent(phase, { eventId: `unknown.operation.${phase}` }),
        'unknown-operation',
      );
    },
  );

  it('accepts requested as the only creation phase and retains display-safe metadata only', () => {
    const event = operationEvent('requested', {
      parentOperationId: 'operation_parent',
      clientAcknowledged: true,
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'identifier', key: 'jobId', value: 'job_1' }],
      },
      error: { code: 'SAFE_FAILURE', messageCode: 'operation.failed', stage: 'provider' },
      policyVersion: 'internal-policy-v9',
      argumentDigests: [
        {
          key: 'secret.path',
          digest: { algorithm: 'sha256', basis: 'utf8', hex: 'a'.repeat(64) },
        },
      ],
      rawFailureClassification: { category: 'private-provider-detail', retryable: false },
      accounting: {
        retainedByteLength: 999_001,
        projectedByteLength: 999_002,
        reducerByteLength: 999_003,
      },
      healthReferences: [{ stage: 'schema', code: 'private-health-reference' }],
    });
    const state = accept(createEmptyReductionState(), event);
    const record = state.operations.get(event.operationId);
    expect(record).toBeDefined();
    if (record === undefined) throw new Error('Expected Operation record');

    const { phase, ...viewFields } = record;
    expect(OperationViewSchema.safeParse({ ...viewFields, operationPhase: phase }).success).toBe(
      true,
    );
    expect(record).toMatchObject({
      operationId: 'operation_1',
      parentOperationId: 'operation_parent',
      phase: 'requested',
      updatedSequence: 1,
      clientAcknowledged: true,
    });
    const serialized = JSON.stringify(record);
    for (const forbidden of [
      'policyVersion',
      'internal-policy-v9',
      'argumentDigests',
      'secret.path',
      'rawFailureClassification',
      'private-provider-detail',
      'accounting',
      '999001',
      'healthReferences',
      'private-health-reference',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps the first Operation descriptor while advancing latest transition fields', () => {
    const requested = operationEvent('requested', {
      runtimeId: 'runtime_first',
      sequence: 1,
      eventId: 'descriptor.operation.requested',
      timestamp: '2026-07-12T01:00:00.000Z',
      parentOperationId: 'parent_first',
      actor: { kind: 'agent', channel: 'local-mcp' },
      surface: 'runtime',
      action: 'get_app_status',
      risk: 'read-only',
      approvalPolicy: 'none',
      clientAcknowledged: false,
      targets: [{ kind: 'runtime', id: 'runtime_first', label: 'first-runtime' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'identifier', key: 'intent', value: 'first_intent' }],
      },
      error: { code: 'OLD_ERROR', messageCode: 'operation.old', stage: 'provider' },
    });
    const running = operationEvent('running', {
      runtimeId: 'runtime_spoofed',
      sequence: 2,
      eventId: 'descriptor.operation.running',
      timestamp: '2026-07-12T02:00:00.000Z',
      parentOperationId: 'parent_spoofed',
      actor: { kind: 'human', channel: 'main' },
      surface: 'workflow',
      action: 'control-workflow.job',
      risk: 'destructive-or-unknown',
      approvalPolicy: 'human-once',
      clientAcknowledged: true,
      targets: [{ kind: 'job', id: 'job_spoofed', label: 'spoofed-job' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'identifier', key: 'intent', value: 'spoofed_intent' }],
      },
      error: { code: 'LATEST_ERROR', messageCode: 'operation.latest', stage: 'reducer' },
    });

    const state = accept(accept(createEmptyReductionState(), requested), running);
    const record = state.operations.get(requested.operationId);
    expect(record).toMatchObject({
      schemaVersion: requested.schemaVersion,
      runtimeId: requested.runtimeId,
      operationId: requested.operationId,
      parentOperationId: requested.parentOperationId,
      actor: requested.actor,
      surface: requested.surface,
      action: requested.action,
      risk: requested.risk,
      approvalPolicy: requested.approvalPolicy,
      authorizationSource: requested.authorizationSource,
      clientAcknowledged: requested.clientAcknowledged,
      targets: requested.targets,
      argumentSummary: requested.argumentSummary,
      sequence: running.sequence,
      eventId: running.eventId,
      timestamp: running.timestamp,
      phase: running.operationPhase,
      updatedSequence: running.sequence,
      error: running.error,
    });

    expectRejected(
      state,
      milestoneEvent({
        operationId: requested.operationId,
        sequence: 3,
        eventId: 'descriptor.operation.disguised-milestone',
        surface: 'workflow',
        action: 'control-workflow.job',
      }),
      'milestone-non-workflow',
    );
  });

  it('ignores timestamp direction and advances only by the supplied forward sequence', () => {
    const requested = operationEvent('requested', {
      sequence: 40,
      eventId: 'reverse-time.requested',
      timestamp: '2026-07-12T12:00:00.000Z',
    });
    const running = operationEvent('running', {
      sequence: 41,
      eventId: 'reverse-time.running',
      timestamp: '2026-07-12T01:00:00.000Z',
    });

    const state = accept(accept(createEmptyReductionState(), requested), running);
    expect(state.operations.get('operation_1')).toMatchObject({
      phase: 'running',
      updatedSequence: 41,
    });
  });
});

describe('call reducer adjacency and binding', () => {
  const cartesian = callPhases.flatMap((from) => callPhases.map((to) => ({ from, to })));

  it.each(cartesian)('reduces $from -> $to according to the exact table', ({ from, to }) => {
    const state = stateAtCallPhase(from);
    const beforeOperations = state.operations;
    const event = callEvent(to, {
      sequence: 20,
      eventId: `candidate.call.${from}.${to}`,
    });
    const result = reduceActivityEvent(state, event);

    if (callTerminals.includes(from)) {
      expect(result).toEqual({ ok: false, code: 'terminal-call' });
      expect(state.calls.get('call_1')?.phase).toBe(from);
      return;
    }

    if (callTransitionIsAllowed(from, to)) {
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error(`Expected ${from} -> ${to} to be accepted`);
      expect(result.state.calls.get('call_1')?.phase).toBe(to);
      expect(result.state.calls.get('call_1')?.updatedSequence).toBe(20);
      expect(result.state.operations).toBe(beforeOperations);
      return;
    }

    expect(result).toEqual({ ok: false, code: 'illegal-call-transition' });
    expect(state.calls.get('call_1')?.phase).toBe(from);
  });

  it.each(callPhases.filter((phase) => phase !== 'received'))(
    'rejects new CallAttempt creation directly at %s',
    (phase) => {
      expectRejected(
        stateAtOperationPhase('requested'),
        callEvent(phase, { eventId: `unbound.call.${phase}` }),
        'illegal-call-transition',
      );
    },
  );

  it('requires an existing Operation before binding a new CallAttempt', () => {
    expectRejected(createEmptyReductionState(), callEvent('received'), 'unknown-operation');
  });

  it('binds the first accepted call transition permanently and rejects association changes', () => {
    let state = stateAtOperationPhase('requested', { operationId: 'operation_a' });
    state = accept(
      state,
      operationEvent('requested', {
        operationId: 'operation_b',
        sequence: 2,
        eventId: 'operation_b.requested',
      }),
    );
    const received = callEvent('received', {
      operationId: 'operation_a',
      callId: 'call_shared',
      sequence: 3,
      eventId: 'call_shared.received',
    });
    state = accept(state, received);
    expect(state.calls.get('call_shared')).toMatchObject({
      operationId: 'operation_a',
      phase: 'received',
    });

    expectRejected(
      state,
      callEvent('started', {
        operationId: 'operation_b',
        callId: 'call_shared',
        sequence: 4,
        eventId: 'call_shared.changed-operation',
      }),
      'call-operation-mismatch',
    );
    expect(state.calls.get('call_shared')).toMatchObject({
      operationId: 'operation_a',
      phase: 'received',
    });
  });

  it('retains display-safe CallAttempt metadata without internal event fields', () => {
    const operationState = stateAtOperationPhase('requested');
    const event = callEvent('received', {
      policyVersion: 'private-policy',
      rawFailureClassification: { category: 'private-call-detail', retryable: true },
      healthReferences: [{ stage: 'listener', code: 'private-listener-detail' }],
    });
    const state = accept(operationState, event);
    const record = state.calls.get(event.callId);
    expect(record).toBeDefined();
    if (record === undefined) throw new Error('Expected CallAttempt record');

    const { phase, ...viewFields } = record;
    expect(CallAttemptViewSchema.safeParse({ ...viewFields, callPhase: phase }).success).toBe(true);
    expect(record).toMatchObject({
      operationId: 'operation_1',
      callId: 'call_1',
      phase: 'received',
      updatedSequence: 2,
    });
    expect(JSON.stringify(record)).not.toMatch(
      /policyVersion|private-policy|rawFailureClassification|private-call-detail|healthReferences|private-listener-detail/u,
    );
  });

  it('keeps the first CallAttempt descriptor while advancing latest phase, event, and error', () => {
    let state = stateAtOperationPhase('requested');
    const received = callEvent('received', {
      runtimeId: 'runtime_call_first',
      sequence: 2,
      eventId: 'descriptor.call.received',
      timestamp: '2026-07-12T03:00:00.000Z',
      parentOperationId: 'call_parent_first',
      actor: { kind: 'agent', channel: 'local-mcp' },
      surface: 'runtime',
      action: 'get_app_status',
      risk: 'read-only',
      approvalPolicy: 'none',
      clientAcknowledged: false,
      targets: [{ kind: 'runtime', id: 'runtime_call_first', label: 'first-call-runtime' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'identifier', key: 'attempt', value: 'first_attempt' }],
      },
      error: { code: 'STALE_CALL_ERROR', messageCode: 'call.stale', stage: 'provider' },
    });
    const started = callEvent('started', {
      runtimeId: 'runtime_call_started',
      sequence: 3,
      eventId: 'descriptor.call.started',
      timestamp: '2026-07-12T04:00:00.000Z',
      parentOperationId: 'call_parent_started',
      actor: { kind: 'human', channel: 'desktop' },
      surface: 'workflow',
      action: 'control-workflow.job',
      risk: 'state-affecting',
      approvalPolicy: 'notify',
      clientAcknowledged: true,
      targets: [{ kind: 'job', id: 'job_started', label: 'started-job' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'identifier', key: 'attempt', value: 'started_attempt' }],
      },
    });
    const failed = callEvent('failed', {
      runtimeId: 'runtime_call_failed',
      sequence: 4,
      eventId: 'descriptor.call.failed',
      timestamp: '2026-07-12T05:00:00.000Z',
      parentOperationId: 'call_parent_failed',
      actor: { kind: 'system', channel: 'main' },
      surface: 'debug',
      action: 'debug.write-memory',
      risk: 'destructive-or-unknown',
      approvalPolicy: 'human-once',
      clientAcknowledged: true,
      targets: [{ kind: 'probe', id: 'probe_failed', label: 'failed-probe' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'identifier', key: 'attempt', value: 'failed_attempt' }],
      },
      error: { code: 'CALL_FAILED', messageCode: 'call.failed', stage: 'provider' },
    });

    state = accept(state, received);
    state = accept(state, started);
    expect(state.calls.get(received.callId)?.error).toBeUndefined();
    state = accept(state, failed);

    expect(state.calls.get(received.callId)).toMatchObject({
      schemaVersion: received.schemaVersion,
      runtimeId: received.runtimeId,
      operationId: received.operationId,
      callId: received.callId,
      parentOperationId: received.parentOperationId,
      actor: received.actor,
      surface: received.surface,
      action: received.action,
      risk: received.risk,
      approvalPolicy: received.approvalPolicy,
      authorizationSource: received.authorizationSource,
      clientAcknowledged: received.clientAcknowledged,
      targets: received.targets,
      argumentSummary: received.argumentSummary,
      sequence: failed.sequence,
      eventId: failed.eventId,
      timestamp: failed.timestamp,
      phase: failed.callPhase,
      updatedSequence: failed.sequence,
      error: failed.error,
    });
  });

  it('allows a later CallAttempt to bind to a terminal Operation without changing it', () => {
    const terminalState = stateAtOperationPhase('succeeded');
    const terminalRecord = terminalState.operations.get('operation_1');
    const next = accept(
      terminalState,
      callEvent('received', { callId: 'late_call', sequence: 10, eventId: 'late_call.received' }),
    );

    expect(next.operations).toBe(terminalState.operations);
    expect(next.operations.get('operation_1')).toBe(terminalRecord);
    expect(next.calls.get('late_call')).toMatchObject({
      operationId: 'operation_1',
      phase: 'received',
    });
  });
});

describe('dispatch isolation, duplicate ids, and terminal immutability', () => {
  it('checks duplicate event ids before every other dispatch failure', () => {
    const acceptedEvent = operationEvent('requested', { eventId: 'event_duplicate' });
    const state = accept(createEmptyReductionState(), acceptedEvent);
    const otherwiseUnknown = callEvent('started', {
      operationId: 'missing_operation',
      callId: 'missing_call',
      eventId: 'event_duplicate',
    });

    expect(reduceActivityEvent(state, otherwiseUnknown)).toEqual({
      ok: false,
      code: 'duplicate-event-id',
    });
  });

  it('adds ids only after success and permits reuse of a previously rejected candidate id', () => {
    const rejectedId = 'event_not_retained';
    const empty = createEmptyReductionState();
    expectRejected(
      empty,
      operationEvent('running', { operationId: 'operation_retry', eventId: rejectedId }),
      'unknown-operation',
    );

    const state = accept(
      empty,
      operationEvent('requested', { operationId: 'operation_retry', eventId: rejectedId }),
    );
    expect(state.acceptedEventIds.has(rejectedId)).toBe(true);
  });

  it('clones only the touched reducer map and the accepted id set', () => {
    const empty = createEmptyReductionState();
    const afterOperation = accept(empty, operationEvent('requested'));
    expect(afterOperation.operations).not.toBe(empty.operations);
    expect(afterOperation.calls).toBe(empty.calls);
    expect(afterOperation.acceptedEventIds).not.toBe(empty.acceptedEventIds);

    const afterCall = accept(afterOperation, callEvent('received'));
    expect(afterCall.operations).toBe(afterOperation.operations);
    expect(afterCall.calls).not.toBe(afterOperation.calls);
    expect(afterCall.acceptedEventIds).not.toBe(afterOperation.acceptedEventIds);

    const workflow = stateAtOperationPhase('running', {
      surface: 'workflow',
      action: 'control-workflow.job',
    });
    const afterMilestone = accept(workflow, milestoneEvent({ sequence: 9 }));
    expect(afterMilestone.operations).not.toBe(workflow.operations);
    expect(afterMilestone.calls).toBe(workflow.calls);
    expect(afterMilestone.acceptedEventIds).not.toBe(workflow.acceptedEventIds);
  });

  it('keeps Operation and CallAttempt reducers isolated in both directions', () => {
    let state = stateAtCallPhase('received');
    const callRecord = state.calls.get('call_1');
    const calls = state.calls;
    state = accept(
      state,
      operationEvent('running', { sequence: 10, eventId: 'isolated.operation.running' }),
    );
    expect(state.calls).toBe(calls);
    expect(state.calls.get('call_1')).toBe(callRecord);

    const operationRecord = state.operations.get('operation_1');
    const operations = state.operations;
    state = accept(state, callEvent('started', { sequence: 11, eventId: 'isolated.call.started' }));
    expect(state.operations).toBe(operations);
    expect(state.operations.get('operation_1')).toBe(operationRecord);
  });

  it('rejects a second terminal decision for both reducers', () => {
    const operationState = stateAtOperationPhase('succeeded');
    expectRejected(
      operationState,
      operationEvent('failed', { sequence: 20, eventId: 'operation.second-terminal' }),
      'terminal-operation',
    );

    const callState = stateAtCallPhase('succeeded');
    expectRejected(
      callState,
      callEvent('failed', { sequence: 20, eventId: 'call.second-terminal' }),
      'terminal-call',
    );
  });

  it.each(operationTerminals)('keeps terminal Operation %s immutable', (terminal) => {
    const state = stateAtOperationPhase(terminal);
    const record = state.operations.get('operation_1');
    expectRejected(
      state,
      operationEvent('running', { sequence: 30, eventId: `immutable.operation.${terminal}` }),
      'terminal-operation',
    );
    expect(state.operations.get('operation_1')).toBe(record);
  });

  it.each(callTerminals)('keeps terminal CallAttempt %s immutable', (terminal) => {
    const state = stateAtCallPhase(terminal);
    const record = state.calls.get('call_1');
    expectRejected(
      state,
      callEvent('started', { sequence: 30, eventId: `immutable.call.${terminal}` }),
      'terminal-call',
    );
    expect(state.calls.get('call_1')).toBe(record);
  });
});

describe('workflow milestones', () => {
  it.each([
    { surface: 'workflow', action: 'control-workflow.job' },
    { surface: 'control-profile', action: 'control-profile.download-job' },
  ] as const)('accepts progress only for $surface:$action', ({ surface, action }) => {
    let state = stateAtOperationPhase('running', { surface, action });
    const before = state.operations.get('operation_1');
    if (before === undefined) throw new Error('Expected workflow Operation');
    const event = milestoneEvent({ surface, action, sequence: 9, eventId: `${surface}.milestone` });
    state = accept(state, event);
    const after = state.operations.get('operation_1');
    if (after === undefined) throw new Error('Expected workflow Operation');

    expect(after).toEqual({ ...before, progress: event.progress, updatedSequence: 9 });
    expect(after.progress).toBe(event.progress);
    expect(after.phase).toBe('running');
    expect(after.surface).toBe(surface);
    expect(after.action).toBe(action);
  });

  it('replaces only bounded progress/evidence references across milestones', () => {
    let state = stateAtOperationPhase('running', {
      surface: 'workflow',
      action: 'control-workflow.job',
    });
    state = accept(state, milestoneEvent({ sequence: 9, eventId: 'milestone.first' }));
    const before = state.operations.get('operation_1');
    if (before === undefined) throw new Error('Expected workflow Operation');
    const replacement = {
      current: 4,
      total: 4,
      percent: 100,
      stepId: 'step_4',
      messageCode: 'workflow.complete',
      evidenceRefs: [{ kind: 'artifact-digest' as const, id: 'artifact_1' }],
    };
    const event = {
      ...milestoneEvent({ sequence: 10, eventId: 'milestone.second' }),
      progress: replacement,
    };
    state = accept(state, event);
    const after = state.operations.get('operation_1');
    if (after === undefined) throw new Error('Expected workflow Operation');

    expect(after).toEqual({ ...before, progress: replacement, updatedSequence: 10 });
    expect(after.progress).toBe(replacement);
  });

  it('preserves milestone progress across ordinary transitions until the next milestone', () => {
    let state = stateAtOperationPhase('running', {
      surface: 'workflow',
      action: 'control-workflow.job',
    });
    const firstMilestone = milestoneEvent({ sequence: 3, eventId: 'progress.first-milestone' });
    state = accept(state, firstMilestone);
    state = accept(
      state,
      operationEvent('cancel-requested', {
        sequence: 4,
        eventId: 'progress.cancel-requested',
        surface: 'workflow',
        action: 'control-workflow.job',
      }),
    );

    expect(state.operations.get('operation_1')).toMatchObject({
      phase: 'cancel-requested',
      updatedSequence: 4,
      progress: firstMilestone.progress,
    });
    expect(state.operations.get('operation_1')?.progress).toBe(firstMilestone.progress);

    const replacement = {
      current: 3,
      total: 4,
      percent: 75,
      stepId: 'step_3',
      messageCode: 'workflow.cancelling',
      evidenceRefs: [{ kind: 'job-step' as const, id: 'job_1', cursorStart: 2, cursorEnd: 3 }],
    };
    const nextMilestone = {
      ...milestoneEvent({ sequence: 5, eventId: 'progress.next-milestone' }),
      progress: replacement,
    };
    state = accept(state, nextMilestone);

    expect(state.operations.get('operation_1')?.progress).toBe(replacement);
    expect(state.operations.get('operation_1')?.updatedSequence).toBe(5);
  });

  it('rejects unknown Operations and ordinary workflow actions with stable codes', () => {
    expectRejected(
      createEmptyReductionState(),
      milestoneEvent({ operationId: 'missing_operation' }),
      'unknown-operation',
    );

    const ordinary = stateAtOperationPhase('running', {
      surface: 'workflow',
      action: 'run_control_workflow',
    });
    expectRejected(
      ordinary,
      milestoneEvent({ action: 'run_control_workflow', eventId: 'ordinary.workflow.milestone' }),
      'milestone-non-workflow',
    );
  });

  it.each([
    { surface: 'control-profile' as const, action: 'control-workflow.job' },
    { surface: 'workflow' as const, action: 'control-profile.download-job' },
    { surface: 'workflow' as const, action: 'different.workflow.job' },
  ])('rejects milestone action/surface mismatch $surface:$action', ({ surface, action }) => {
    const state = stateAtOperationPhase('running', {
      surface: 'workflow',
      action: 'control-workflow.job',
    });
    expectRejected(
      state,
      milestoneEvent({
        surface,
        action,
        eventId: `mismatched.milestone.${surface}.${action}`,
      }),
      'milestone-non-workflow',
    );
  });

  it('rejects a runtime-forged own operationPhase before applying milestone progress', () => {
    const state = stateAtOperationPhase('running', {
      surface: 'workflow',
      action: 'control-workflow.job',
    });
    const forged = {
      ...milestoneEvent({ eventId: 'forged.milestone.phase' }),
      operationPhase: 'succeeded',
    } as unknown as RetainedActivityEvent;

    expectRejected(state, forged, 'milestone-phase-change');
    expect(state.operations.get('operation_1')?.phase).toBe('running');
    expect(state.operations.get('operation_1')?.progress).toBeUndefined();
  });

  it.each(operationTerminals)('rejects milestones for terminal Operation %s', (terminal) => {
    const state = stateAtOperationPhase(terminal, {
      surface: 'workflow',
      action: 'control-workflow.job',
    });
    expectRejected(
      state,
      milestoneEvent({ eventId: `terminal.milestone.${terminal}` }),
      'terminal-operation',
    );
  });

  it('gives terminal immutability precedence even for a non-workflow Operation', () => {
    const state = stateAtOperationPhase('succeeded');
    expectRejected(
      state,
      milestoneEvent({ eventId: 'terminal.non-workflow.milestone' }),
      'terminal-operation',
    );
  });
});

describe('runtime-end classification', () => {
  const expectedByPhase: Record<
    OperationPhase,
    ReturnType<typeof classifyOperationsAtRuntimeEnd>
  > = {
    requested: [
      {
        operationId: 'operation_1',
        phase: 'rejected',
        reason: 'runtime-ended-before-admission',
      },
    ],
    'awaiting-approval': [
      { operationId: 'operation_1', phase: 'expired', reason: 'runtime-restart' },
    ],
    blocked: [{ operationId: 'operation_1', phase: 'expired', reason: 'runtime-restart' }],
    queued: [{ operationId: 'operation_1', phase: 'interrupted', reason: 'runtime-restart' }],
    running: [{ operationId: 'operation_1', phase: 'interrupted', reason: 'runtime-restart' }],
    'cancel-requested': [
      { operationId: 'operation_1', phase: 'interrupted', reason: 'runtime-restart' },
    ],
    succeeded: [],
    failed: [],
    rejected: [],
    denied: [],
    expired: [],
    superseded: [],
    cancelled: [],
    interrupted: [],
  };

  it.each(operationPhases)('maps %s exactly without mutating reducer state', (phase) => {
    const state = stateAtOperationPhase(phase);
    const before = stateSnapshot(state);
    expect(classifyOperationsAtRuntimeEnd(state)).toEqual(expectedByPhase[phase]);
    expect(stateSnapshot(state)).toEqual(before);
  });
});

declare const syntheticOperationReferenceBrand: unique symbol;
type SyntheticOperationReference = Readonly<{
  [syntheticOperationReferenceBrand]: true;
}>;

class SyntheticFutureStateFixture {
  #state = createEmptyReductionState();
  #sequence = 0;
  readonly #issuedOperationReferences = new WeakSet<SyntheticOperationReference>();
  readonly #operationIdsByReference = new WeakMap<SyntheticOperationReference, string>();
  readonly #selectedCallIdsByReference = new WeakMap<SyntheticOperationReference, string>();
  readonly history: RetainedActivityEvent[] = [];

  get state(): ActivityReductionState {
    return this.#state;
  }

  operation(operationId: string, phase: OperationPhase): void {
    this.#emit(
      operationEvent(phase, {
        operationId,
        sequence: this.#sequence + 1,
        eventId: `future.${this.#sequence + 1}.${operationId}.${phase}`,
      }),
    );
  }

  call(operationId: string, callId: string, phase: CallAttemptPhase): void {
    this.#emit(
      callEvent(phase, {
        operationId,
        callId,
        sequence: this.#sequence + 1,
        eventId: `future.${this.#sequence + 1}.${callId}.${phase}`,
      }),
    );
  }

  openApproval(operationId: string, callId: string): SyntheticOperationReference {
    this.operation(operationId, 'requested');
    this.call(operationId, callId, 'received');
    this.operation(operationId, 'awaiting-approval');
    this.call(operationId, callId, 'approval-required');

    const reference = Object.freeze({}) as SyntheticOperationReference;
    this.#issuedOperationReferences.add(reference);
    this.#operationIdsByReference.set(reference, operationId);
    return reference;
  }

  decideApprovedRetry(reference: SyntheticOperationReference, callId: string): boolean {
    if (!this.#issuedOperationReferences.has(reference)) return false;

    const operationId = this.#operationIdsByReference.get(reference);
    if (operationId === undefined) return false;
    const call = this.#state.calls.get(callId);
    if (call?.operationId !== operationId || call.phase !== 'received') return false;

    if (this.#selectedCallIdsByReference.has(reference)) {
      this.call(operationId, callId, 'rejected');
      return false;
    }

    this.operation(operationId, 'queued');
    this.call(operationId, callId, 'started');
    this.#selectedCallIdsByReference.set(reference, callId);
    return true;
  }

  phasesForOperation(operationId: string): OperationPhase[] {
    return this.history
      .filter(
        (event): event is RetainedOperationTransition =>
          event.kind === 'operation-transition' && event.operationId === operationId,
      )
      .map((event) => event.operationPhase);
  }

  phasesForCall(callId: string): CallAttemptPhase[] {
    return this.history
      .filter(
        (event): event is RetainedCallTransition =>
          event.kind === 'call-transition' && event.callId === callId,
      )
      .map((event) => event.callPhase);
  }

  #emit(event: RetainedActivityEvent): void {
    const result: ReductionResult = reduceActivityEvent(this.#state, event);
    if (!result.ok) {
      throw new Error(`Synthetic fixture rejected ${event.eventId}: ${result.code}`);
    }
    this.#state = result.state;
    this.#sequence = event.sequence;
    this.history.push(event);
  }
}

describe('synthetic future approval states (fixture only)', () => {
  it('reuses one Operation across approval-required Calls A/B and executes only Call C', () => {
    const fixture = new SyntheticFutureStateFixture();
    fixture.openApproval('operation_approval', 'call_a');
    fixture.call('operation_approval', 'call_b', 'received');
    fixture.call('operation_approval', 'call_b', 'approval-required');

    expect(fixture.phasesForCall('call_a')).toEqual(['received', 'approval-required']);
    expect(fixture.phasesForCall('call_b')).toEqual(['received', 'approval-required']);
    expect(fixture.state.operations.get('operation_approval')?.phase).toBe('awaiting-approval');

    fixture.call('operation_approval', 'call_c', 'received');
    fixture.operation('operation_approval', 'queued');
    fixture.call('operation_approval', 'call_c', 'started');
    fixture.operation('operation_approval', 'running');
    fixture.call('operation_approval', 'call_c', 'succeeded');
    fixture.operation('operation_approval', 'succeeded');

    expect(fixture.phasesForCall('call_c')).toEqual(['received', 'started', 'succeeded']);
    expect(fixture.phasesForOperation('operation_approval')).toEqual([
      'requested',
      'awaiting-approval',
      'queued',
      'running',
      'succeeded',
    ]);
  });

  it('allows at most one concurrent approved-retry execution decision and rejects losers', () => {
    const fixture = new SyntheticFutureStateFixture();
    const reference = fixture.openApproval(
      'operation_race',
      'call_a',
    ) as unknown as SyntheticOperationReference;
    fixture.call('operation_race', 'call_c', 'received');
    fixture.call('operation_race', 'call_d', 'received');

    expect(fixture.decideApprovedRetry(reference, 'call_c')).toBe(true);
    const selectedOperation = fixture.state.operations.get('operation_race');
    expect(selectedOperation?.phase).toBe('queued');
    expect(fixture.decideApprovedRetry(reference, 'call_d')).toBe(false);

    fixture.call('operation_race', 'call_e', 'received');
    expect(fixture.decideApprovedRetry(reference, 'call_e')).toBe(false);

    fixture.call('operation_race', 'call_f', 'received');
    const forgedReference = Object.freeze({}) as SyntheticOperationReference;
    expect(fixture.decideApprovedRetry(forgedReference, 'call_f')).toBe(false);

    expect(fixture.state.operations.get('operation_race')).toBe(selectedOperation);
    expect(fixture.phasesForCall('call_d')).toEqual(['received', 'rejected']);
    expect(fixture.phasesForCall('call_e')).toEqual(['received', 'rejected']);
    expect(fixture.phasesForCall('call_f')).toEqual(['received']);
    fixture.operation('operation_race', 'running');
    fixture.call('operation_race', 'call_c', 'succeeded');
    fixture.operation('operation_race', 'succeeded');

    expect(fixture.phasesForCall('call_c')).toEqual(['received', 'started', 'succeeded']);
    expect(
      ['call_c', 'call_d', 'call_e', 'call_f'].filter((callId) =>
        fixture.phasesForCall(callId).includes('started'),
      ),
    ).toEqual(['call_c']);
  });

  it('keeps resolution without retry non-executing', () => {
    const fixture = new SyntheticFutureStateFixture();
    fixture.openApproval('operation_resolution_only', 'call_a');

    expect(fixture.state.operations.get('operation_resolution_only')?.phase).toBe(
      'awaiting-approval',
    );
    const operationPhases = fixture.phasesForOperation('operation_resolution_only');
    for (const executionPhase of ['queued', 'running', 'succeeded', 'failed'] as const) {
      expect(operationPhases).not.toContain(executionPhase);
    }
    expect(
      fixture.history.some(
        (event) => event.kind === 'call-transition' && event.callPhase === 'started',
      ),
    ).toBe(false);
  });

  it('keeps a paused approval blocked until synthetic resume/revalidation', () => {
    const fixture = new SyntheticFutureStateFixture();
    fixture.openApproval('operation_paused', 'call_a');
    fixture.operation('operation_paused', 'blocked');
    fixture.call('operation_paused', 'call_b', 'received');
    let revalidated = false;
    const tryStart = (): boolean => {
      if (!revalidated) return false;
      fixture.operation('operation_paused', 'queued');
      fixture.call('operation_paused', 'call_b', 'started');
      return true;
    };

    expect(tryStart()).toBe(false);
    expect(fixture.state.operations.get('operation_paused')?.phase).toBe('blocked');
    expect(fixture.phasesForCall('call_b')).toEqual(['received']);

    revalidated = true;
    expect(tryStart()).toBe(true);
    expect(fixture.state.operations.get('operation_paused')?.phase).toBe('queued');
    expect(fixture.phasesForCall('call_b')).toEqual(['received', 'started']);
  });

  it('expires TTL without a started call', () => {
    const fixture = new SyntheticFutureStateFixture();
    fixture.openApproval('operation_ttl', 'call_a');
    fixture.operation('operation_ttl', 'expired');

    expect(fixture.state.operations.get('operation_ttl')?.phase).toBe('expired');
    expect(
      fixture.history.some(
        (event) => event.kind === 'call-transition' && event.callPhase === 'started',
      ),
    ).toBe(false);
  });

  it('supersedes an old Operation when a new semantic intent arrives', () => {
    const fixture = new SyntheticFutureStateFixture();
    fixture.openApproval('operation_old_intent', 'call_old');
    fixture.operation('operation_old_intent', 'superseded');
    fixture.operation('operation_new_intent', 'requested');

    expect(fixture.state.operations.get('operation_old_intent')?.phase).toBe('superseded');
    expect(fixture.state.operations.get('operation_new_intent')?.phase).toBe('requested');
    expect(fixture.state.operations.size).toBe(2);
  });

  it('models confirm false then true as two server-generated Operations', () => {
    const fixture = new SyntheticFutureStateFixture();
    let serverId = 0;
    const invokeCurrentProductionShape = (
      confirm: boolean,
    ): { operationId: string; callId: string } => {
      serverId += 1;
      const operationId = `server_operation_${serverId}`;
      const callId = `server_call_${serverId}`;
      fixture.operation(operationId, 'requested');
      fixture.call(operationId, callId, 'received');
      if (!confirm) {
        fixture.call(operationId, callId, 'rejected');
        fixture.operation(operationId, 'rejected');
      } else {
        fixture.call(operationId, callId, 'started');
        fixture.operation(operationId, 'running');
        fixture.call(operationId, callId, 'succeeded');
        fixture.operation(operationId, 'succeeded');
      }
      return { operationId, callId };
    };

    const withoutConfirmation = invokeCurrentProductionShape(false);
    const withConfirmation = invokeCurrentProductionShape(true);

    expect(withoutConfirmation.operationId).not.toBe(withConfirmation.operationId);
    expect(withoutConfirmation.callId).not.toBe(withConfirmation.callId);
    expect(fixture.state.operations.get(withoutConfirmation.operationId)?.phase).toBe('rejected');
    expect(fixture.state.operations.get(withConfirmation.operationId)?.phase).toBe('succeeded');
    expect(fixture.state.operations.size).toBe(2);
  });
});
